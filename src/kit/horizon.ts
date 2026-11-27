// The land at the foot of every page: the same night as the landing, but a
// different place on each tab, so the app feels like one world, not a copy.
// A low strip of mountains and hills with pines, behind the content (cards
// and panels cover it); each place has its own small landmark and life:
//   course:     the shore of the lake of the landing,
//   review:     a lighthouse whose light sweeps the night (coming back),
//   practice:   a thick wood with fireflies,
//   mistakes:   a small bridge over a stream (the way over a problem),
//   knowledge:  an observatory with its telescope towards the stars,
//   playground: a campfire with sparks (a place to play),
//   cheatsheet: a cabin with a lit window and smoke (notes at home),
//   next:       a dotted path up to a flag on a far hill (the road ahead),
//   lesson:     plain hills, lower, above the bar of the lesson.
// Birds cross now and then everywhere. Reduced motion: all still.
import { BIRD, CELL, Layer, bayer, cross, paintLake, splitWaves, sprite, waveLayers } from './landscape';
import { isReduced } from './motion';

export type HorizonPlace = 'course' | 'review' | 'practice' | 'mistakes' | 'knowledge' | 'playground' | 'cheatsheet' | 'next' | 'lesson' | 'plain';

/** The lighthouse: a lamp room, a gallery, a striped tower on a rock. */
const LIGHTHOUSE = sprite(
  9,
  24,
  (x, y) => {
    if (y === 0) return x >= 3 && x <= 5 ? 'lh-dark' : '';
    if (y === 1) return x >= 2 && x <= 6 ? 'lh-dark' : '';
    if (y <= 4) return x === 2 || x === 6 ? 'lh-dark' : x > 2 && x < 6 ? 'lh-lamp' : '';
    if (y === 5) return x >= 1 && x <= 7 ? 'lh-dark' : '';
    if (y <= 20) {
      const half = 1 + Math.floor((y - 6) / 6);
      if (x < 4 - half || x > 4 + half) return '';
      if (x === 4 - half || x === 4 + half) return 'lh-dark';
      if (y >= 18 && x === 4) return 'lh-dark';
      return Math.floor((y - 6) / 3) % 2 ? 'lh-white' : 'lh-red';
    }
    return 'lh-rock';
  },
  'lh',
);

/** The observatory: a dome with an open slit, on a small house of stone. */
const OBSERVATORY = sprite(
  17,
  15,
  (x, y) => {
    const cx = 8;
    if (y <= 7) {
      const r = Math.hypot(x - cx, (y - 7.5) * 1.05);
      if (r > 7.6) return '';
      if (x >= 7 && x <= 9 && y >= 1) return 'ob-slit';
      return r > 6.6 ? 'lh-dark' : x < cx ? 'ob-dome-lit' : 'ob-dome';
    }
    if (x < 1 || x > 15) return '';
    if (x === 1 || x === 15 || y === 14 || y === 8) return 'lh-dark';
    if (y >= 10 && y <= 11 && x >= 4 && x <= 5) return 'lh-lamp';
    if (y >= 10 && x >= 10 && x <= 11) return 'lh-dark';
    return 'ob-wall';
  },
  'ob',
);

const SEED: Record<HorizonPlace, number> = { course: 1, review: 2, practice: 5, mistakes: 3, knowledge: 8, playground: 6, cheatsheet: 9, next: 4, lesson: 11, plain: 14 };
// Where the landmark of each place stands (a share of the width), and where
// no pines may grow around it.
const MARK_AT: Partial<Record<HorizonPlace, number>> = { review: 0.82, knowledge: 0.78, mistakes: 0.4, playground: 0.22, cheatsheet: 0.74, next: 0.84 };

/** A wooden bridge with a small arch and two rails. */
const BRIDGE = sprite(
  22,
  8,
  (x, y) => {
    if (y === 0 && (x === 1 || x === 20)) return 'br-post';
    if (y === 1) return x === 1 || x === 20 ? 'br-post' : x > 1 && x < 20 ? 'br-rail' : '';
    if (y === 2) return x === 1 || x === 20 || x % 4 === 1 ? 'br-post' : '';
    if (y === 3) return 'br-deck';
    if (y === 4) return x < 3 || x > 18 ? 'br-deck' : '';
    const arch = Math.abs(x - 10.5) < 10.5 - (y - 4) * 2.4;
    return y >= 5 && !arch && (x < 4 || x > 17) ? 'br-deck' : '';
  },
  'br',
);

/** The logs of the campfire (the fire itself is drawn by CSS, in frames). */
const LOGS = sprite(
  11,
  3,
  (x, y) => {
    if (y === 0) return x >= 3 && x <= 7 ? 'cf-log2' : '';
    if (y === 1) return x >= 1 && x <= 9 ? 'cf-log' : '';
    return x === 0 || x === 10 || (x >= 2 && x <= 8) ? 'cf-stone' : '';
  },
  'cf',
);

/** The cabin: roof, walls of wood, a lit window, a door and a chimney. */
const CABIN = sprite(
  15,
  13,
  (x, y) => {
    if (x >= 10 && x <= 11 && y <= 3) return 'lh-dark';
    if (y <= 6) {
      const half = y + 1;
      if (x >= 7 - half && x <= 7 + half) return x === 7 - half || x === 7 + half ? 'lh-dark' : 'cb-roof';
      return '';
    }
    if (x < 1 || x > 13) return '';
    if (x === 1 || x === 13 || y === 12) return 'lh-dark';
    if (y >= 8 && y <= 9 && x >= 3 && x <= 5) return 'cb-window';
    if (y >= 8 && x >= 9 && x <= 10) return 'lh-dark';
    return 'cb-wall';
  },
  'cb',
);

/** A small flag on a pole. */
const FLAG = sprite(
  8,
  12,
  (x, y) => {
    if (x === 1) return 'fl-pole';
    if (y >= 1 && y <= 4 && x >= 2 && x <= 7 - (y === 4 ? 2 : y === 1 ? 1 : 0)) return 'fl-cloth';
    return '';
  },
  'fl',
);

let el: HTMLElement | null = null;
let art: SVGSVGElement | null = null;
let waves: SVGSVGElement[] = [];
let place: HorizonPlace | null = null;
const timers: number[] = [];

function draw(): void {
  if (!el || !art || !place) return;
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (!width || !height) return;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const seed = SEED[place];
  art.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
  const L: Record<string, Layer> = {
    back: new Layer(),
    backRim: new Layer(),
    mid: new Layer(),
    trees: new Layer(),
    front: new Layer(),
    frontRim: new Layer(),
    stream: new Layer(),
    glow: new Layer(),
    path: new Layer(),
  };
  const lake = place === 'course';
  if (lake) for (const k of ['bank', 'bankRim', 'grass', 'water', 'rBack', 'rMid', 'rTrees', 'rStars', 'edge', 'waveA', 'waveB']) L[k] = new Layer();
  const tri = (v: number): number => 1 - Math.abs((((v % 1) + 1) % 1) - 0.5) * 2;
  const backH = (x: number): number => Math.round(rows * 0.5 + rows * 0.3 * tri(x / 57 + seed * 0.13) ** 1.4 + rows * 0.12 * tri(x / 21 + seed * 0.3) ** 2);
  const midH = (x: number): number => Math.round(rows * 0.38 + 3 * Math.sin(x * 0.03 + seed) + 2 * Math.sin(x * 0.09 + seed * 2));
  const frontH = (x: number): number => Math.round(rows * 0.14 + Math.sin(x * 0.05 + seed));
  const markAt = MARK_AT[place];
  const markX = markAt === undefined ? -999 : Math.round(cols * markAt);
  for (let x = 0; x < cols; x += 1) {
    const bh = backH(x);
    L.back.cell(x, rows - bh + 1, 1, bh - 1);
    L.backRim.cell(x, rows - bh);
    const mh = midH(x);
    L.mid.cell(x, rows - mh, 1, mh);
    if (lake) continue;
    const fh = frontH(x);
    // Mistakes: a stream comes down through the ground, under the bridge.
    if (place === 'mistakes' && Math.abs(x - markX) < 8) {
      L.stream.cell(x, rows - fh + 2, 1, fh - 2);
      L.frontRim.cell(x, rows - fh + 1);
      continue;
    }
    L.front.cell(x, rows - fh + 1, 1, fh - 1);
    L.frontRim.cell(x, rows - fh);
  }
  // Pines: a thick wood for practice, small groups elsewhere.
  const trees: [number, number, number][] = [];
  const pine = [1, 1, 3, 3, 5, 3, 5, 7, 5, 7, 9, 1];
  const step = place === 'practice' ? 0.022 : 0.075;
  for (let g = 0.03 + (seed % 3) * 0.01; g < 0.98; g += step + (place === 'practice' ? 0 : bayer(Math.round(g * 99), seed) * 0.08)) {
    const tx = Math.round(cols * g);
    if (Math.abs(tx - markX) < 12) continue;
    const tall = bayer(tx, seed) < 0.5 ? pine : pine.slice(2);
    const base = rows - midH(tx) + 1;
    tall.forEach((w, i) => {
      L.trees.cell(tx - Math.floor(w / 2), base - tall.length + i, w, 1);
      trees.push([tx - Math.floor(w / 2), base - tall.length + i, w]);
    });
  }
  if (lake) paintLake(L, cols, rows, Math.round(rows * 0.26), midH, backH, trees);
  // Playground: the light of the fire on the ground, dithered.
  if (place === 'playground') {
    const gy = rows - frontH(markX);
    for (let y = gy - 3; y < rows; y += 1) {
      for (let x = markX - 22; x <= markX + 22; x += 1) {
        const d = Math.hypot((x - markX) / 22, (y - gy) / 6);
        if (d < 1 && bayer(x, y) < (1 - d) ** 1.5 * 0.6) L.glow.cell(x, y);
      }
    }
  }
  // After the course: a dotted path from the left, up the hill to the flag.
  if (place === 'next') {
    for (let x = 4; x < markX; x += 3) {
      const t = x / markX;
      const ground = rows - frontH(x) + 2;
      const hill = rows - midH(markX) + 1;
      const y = Math.round(t < 0.6 ? ground : ground + (hill - ground) * ((t - 0.6) / 0.4) ** 1.4);
      L.path.cell(x, y, 2, 1);
    }
  }
  const parts = splitWaves(L);
  art.innerHTML = parts.land;
  waves.forEach((svg, i) => {
    svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    svg.innerHTML = i ? parts.b : parts.a;
  });
  // The landmark stands on the hills at its place.
  const mark = el.querySelector<HTMLElement>('.hz-mark');
  if (mark) {
    const at = Number(mark.dataset.at);
    const mx = Math.round(cols * at);
    mark.style.left = `${at * 100}%`;
    mark.style.bottom = `${((mark.dataset.on === 'front' ? frontH(mx) : midH(mx)) - 1) / rows * 100}%`;
  }
  for (const fly of el.querySelectorAll<HTMLElement>('.sc-fly')) {
    fly.style.bottom = `${((midH(Math.round(cols * Number(fly.dataset.at))) + Number(fly.dataset.lift)) / rows) * 100}%`;
  }
}

function life(): void {
  if (!el) return;
  const between = (a: number, b: number): number => a + Math.random() * (b - a);
  const fly = (): void => {
    if (el && !document.hidden && !isReduced()) {
      const toLeft = Math.random() < 0.5;
      const count = 1 + Math.floor(Math.random() * 2);
      const height = between(70, 90);
      const seconds = between(22, 34);
      for (let i = 0; i < count; i += 1) {
        const bird = document.createElement('div');
        bird.className = 'sc-bird';
        bird.innerHTML = BIRD;
        bird.style.bottom = `${height - i * 4}%`;
        el.append(bird);
        timers.push(window.setTimeout(() => void cross(bird, seconds, toLeft).then(() => bird.remove()), i * 700));
      }
    }
    timers.push(window.setTimeout(fly, between(30000, 70000)));
  };
  timers.push(window.setTimeout(fly, between(6000, 20000)));
}

/** Puts the strip of land behind the app (once). */
export function mountHorizon(): void {
  if (el) return;
  el = document.createElement('div');
  el.className = 'horizon';
  el.setAttribute('aria-hidden', 'true');
  art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  art.setAttribute('class', 'scene-art');
  art.setAttribute('shape-rendering', 'crispEdges');
  art.setAttribute('preserveAspectRatio', 'none');
  el.append(art);
  waves = waveLayers(el);
  const sky = document.querySelector('.sky');
  if (sky) sky.after(el);
  else document.body.prepend(el);
  new ResizeObserver(() => draw()).observe(el);
  life();
}

/** Shows the place of a page, or hides the land (null: the landing has its own). */
export function setHorizon(next: HorizonPlace | null): void {
  if (!el) return;
  el.hidden = next === null;
  document.documentElement.classList.toggle('has-horizon', next !== null);
  if (next === null || next === place) return;
  place = next;
  el.className = `horizon hz-${next}`;
  for (const old of el.querySelectorAll('.hz-mark, .sc-fly')) old.remove();
  const mark = (html: string, on: 'mid' | 'front', extra = ''): void => {
    el!.insertAdjacentHTML('beforeend', `<div class="hz-mark hz-mark-${next}" data-at="${MARK_AT[next]}" data-on="${on}">${extra}${html}</div>`);
  };
  if (next === 'review') mark(LIGHTHOUSE, 'front', '<i class="hz-beam"></i>');
  else if (next === 'knowledge') mark(OBSERVATORY + '<i class="sc-scope"></i>', 'mid');
  else if (next === 'mistakes') mark(BRIDGE, 'front', '<i class="hz-flow"></i><i class="hz-flow"></i><i class="hz-flow"></i>');
  else if (next === 'playground') mark(LOGS, 'front', '<i class="hz-fire"></i><i class="hz-spark"></i><i class="hz-spark"></i><i class="hz-spark"></i>');
  else if (next === 'cheatsheet') mark(CABIN, 'mid', '<i class="hz-smoke"></i><i class="hz-smoke"></i><i class="hz-smoke"></i>');
  else if (next === 'next') mark(FLAG, 'mid');
  else if (next === 'practice') {
    [0.08, 0.16, 0.27, 0.41, 0.55, 0.66, 0.79, 0.9].forEach((at, i) => {
      el!.insertAdjacentHTML(
        'beforeend',
        `<i class="sc-fly" data-at="${at}" data-lift="${3 + ((i * 5) % 7)}" style="left:${at * 100}%;animation-delay:${(-i * 1.37) % 5}s,${(-i * 2.1) % 7}s"></i>`,
      );
    });
  }
  draw();
}
