// The pixel scene at the foot of the landing, like the title screen of a
// game (chosen by the owner, 27 November 2026): far mountains and round hills
// with pines, under the sky, and a lake in front that mirrors them. The land
// is drawn for the width of the page, in pixels of 4 x 4, and again when the
// page changes size.
// Life on the lake, each at its own random time and never in a crowd: a
// small sailboat comes in from one side and sails out of the other, with
// its reflection; a fish jumps and leaves a ring; a few birds fly across.
// Lines of light come and go on the water. Reduced motion: all still.
import { isReduced } from './motion';

const CELL = 4;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number): number => (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;

export interface Scene {
  el: HTMLElement;
  dispose(): void;
}

/** A path of one class made of 1 x 1 cells. */
class Layer {
  d = '';
  cell(x: number, y: number, w = 1, h = 1): void {
    if (w > 0 && h > 0) this.d += `M${x} ${y}h${w}v${h}h-${w}z`;
  }
}

/** A small sprite: cells by class, drawn at the pixel size of the land. */
function sprite(cols: number, rows: number, cell: (x: number, y: number) => string, className: string, size = CELL): string {
  const layers = new Map<string, Layer>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const c = cell(x, y);
      if (!c) continue;
      if (!layers.has(c)) layers.set(c, new Layer());
      layers.get(c)!.cell(x, y);
    }
  }
  const paths = [...layers].map(([c, l]) => `<path class="${c}" d="${l.d}"/>`).join('');
  return `<svg class="${className}" viewBox="0 0 ${cols} ${rows}" width="${cols * size}" height="${rows * size}" shape-rendering="crispEdges">${paths}</svg>`;
}

/** The sailboat: a mast with a small flag, two white sails, a wooden hull. */
const BOAT = sprite(
  14,
  10,
  (x, y) => {
    if (y === 0 && (x === 7 || x === 8)) return 'bt-flag';
    if (x === 6 && y <= 8) return 'bt-mast';
    if (y >= 1 && y <= 7 && x >= 7 && x <= 6 + y) return 'bt-sail';
    if (y >= 3 && y <= 7 && x >= 8 - y && x <= 5) return 'bt-sail2';
    if (y === 8 && x >= 1 && x <= 12) return x === 1 || x === 12 ? 'bt-dark' : 'bt-hull';
    if (y === 9 && x >= 2 && x <= 11) return 'bt-dark';
    return '';
  },
  'bt',
  6,
);

/** A small fish, seen from the side. */
const FISH = sprite(
  6,
  3,
  (x, y) => {
    if (x === 0) return y !== 1 ? 'fs-body' : '';
    if (x === 1) return y === 1 ? 'fs-body' : '';
    if (x === 4 && y === 0) return 'fs-eye';
    if (x >= 2 && x <= 4) return 'fs-body';
    if (x === 5) return y === 1 ? 'fs-body' : '';
    return '';
  },
  'fs',
  6,
);

/** A bird, two frames: the wings up (a V), then down. */
const BIRD_UP = ['x.....x', '.x...x.', '..xxx..'];
const BIRD_DOWN = ['..xxx..', '.x...x.', 'x.....x'];
const birdFrame = (rows: string[]): string => sprite(7, 3, (x, y) => (rows[y][x] === 'x' ? 'bd-body' : ''), 'bd', 3);
const BIRD = birdFrame(BIRD_UP) + birdFrame(BIRD_DOWN);

export function landscape(): Scene {
  const el = document.createElement('div');
  el.className = 'scene';
  el.setAttribute('aria-hidden', 'true');
  const art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  art.setAttribute('class', 'scene-art');
  art.setAttribute('shape-rendering', 'crispEdges');
  art.setAttribute('preserveAspectRatio', 'none');
  el.append(art);

  // Short lines of light on the water.
  const ripples = Array.from({ length: 16 }, (_, i) => {
    const r = document.createElement('i');
    r.className = 'sc-ripple';
    r.style.left = `${((i * 37) % 97) + 1.5}%`;
    r.style.width = `${8 + ((i * 13) % 5) * 4}px`;
    r.style.animationDelay = `${(-i * 0.9) % 6}s`;
    el.append(r);
    return r;
  });
  // The boat and its reflection move together; the fish leaves a ring.
  const boat = document.createElement('div');
  boat.className = 'sc-boat';
  boat.innerHTML = `<div class="sc-boat-up">${BOAT}</div><div class="sc-boat-down">${BOAT}</div>`;
  const fish = document.createElement('div');
  fish.className = 'sc-fish';
  fish.innerHTML = FISH;
  const ring = document.createElement('i');
  ring.className = 'sc-ring';
  el.append(boat, fish, ring);

  let shore = 0; // the shoreline, in % of the height of the scene, from the bottom

  function draw(): void {
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (!width || !height) return;
    const cols = Math.ceil(width / CELL);
    const rows = Math.ceil(height / CELL);
    art.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    const L = {
      back: new Layer(),
      backRim: new Layer(),
      mid: new Layer(),
      midShade: new Layer(),
      trees: new Layer(),
      water: new Layer(),
      rBack: new Layer(),
      rMid: new Layer(),
      rTrees: new Layer(),
      shore: new Layer(),
      rStars: new Layer(),
    };
    const tri = (v: number): number => 1 - Math.abs((((v % 1) + 1) % 1) - 0.5) * 2;
    const lakeH = Math.round(rows * 0.34);
    const shoreY = rows - lakeH; // the first row of water
    // Far mountains: sharp peaks of different sizes.
    const backH = (x: number): number =>
      Math.round(rows * 0.52 + rows * 0.2 * tri(x / 61 + 0.3) ** 1.4 + rows * 0.11 * tri(x / 23 + 0.1) ** 2 + 2 * Math.sin(x * 0.4));
    // Middle hills: round, with woods on them, down to the water.
    const midH = (x: number): number => Math.round(rows * 0.45 + 5 * Math.sin(x * 0.028 + 0.6) + 3 * Math.sin(x * 0.081 + 2));
    for (let x = 0; x < cols; x += 1) {
      const bh = backH(x);
      L.back.cell(x, rows - bh + 1, 1, bh - lakeH - 1);
      L.backRim.cell(x, rows - bh);
      const mh = midH(x);
      L.mid.cell(x, rows - mh, 1, mh - lakeH);
      // The side away from the light gets a dithered shade.
      if (midH(x + 1) - midH(x - 1) < 0) for (let y = rows - mh; y < rows - mh + 5; y += 1) if (bayer(x, y) < 0.5) L.midShade.cell(x, y);
    }
    // Small pines on the hills, in groups.
    const treeCells: [number, number, number][] = [];
    const pine = [1, 1, 3, 3, 5, 3, 5, 7, 5, 7, 9, 1];
    for (const g of [0.07, 0.11, 0.3, 0.34, 0.37, 0.5, 0.53, 0.64, 0.68, 0.9, 0.94]) {
      const tx = Math.round(cols * g);
      const base = rows - midH(tx) + 1;
      const tall = Math.round(g * 100) % 2 ? pine : pine.slice(2);
      tall.forEach((w, i) => {
        const x0 = tx - Math.floor(w / 2);
        const y = base - tall.length + i;
        L.trees.cell(x0, y, w, 1);
        treeCells.push([x0, y, w]);
      });
    }
    // The lake: the water, then the land mirrored in it. Every third row of
    // the mirror is left out and the rows shift a little: that reads as water.
    L.water.cell(0, shoreY, cols, lakeH);
    for (let d = 0; d < lakeH; d += 1) {
      if (d % 3 === 2) continue;
      const y = shoreY + d;
      const shift = Math.round(Math.sin(d * 1.7) * (1 + d / 8));
      const fade = d / lakeH;
      for (let x = 0; x < cols; x += 1) {
        const sx = Math.min(cols - 1, Math.max(0, x + shift));
        const up = d + 1; // the height above the shore that this row mirrors
        if (up <= midH(sx) - lakeH) {
          if (bayer(x, y) < 0.95 - fade * 0.5) L.rMid.cell(x, y);
        } else if (up <= backH(sx) - lakeH && bayer(x, y) < 0.8 - fade * 0.6) L.rBack.cell(x, y);
      }
    }
    for (const [x0, y, w] of treeCells) {
      const d = shoreY - 1 - y;
      if (d >= 0 && d < lakeH && d % 3 !== 2) L.rTrees.cell(x0 + Math.round(Math.sin(d * 1.7)), shoreY + d, w, 1);
    }
    // A few stars mirrored in the open water, where no land is mirrored.
    for (let x = 3; x < cols; x += 1) {
      if (bayer(x * 5, x) < 0.05) {
        const d = 4 + ((x * 7) % (lakeH - 6));
        if (d % 3 !== 2 && d + 1 > backH(x) - lakeH) L.rStars.cell(x, shoreY + d);
      }
    }
    // The shoreline: a thin bright edge where the land meets the water.
    for (let x = 0; x < cols; x += 1) if (bayer(x, 1) < 0.85) L.shore.cell(x, shoreY);
    art.innerHTML = Object.entries(L)
      .map(([name, layer]) => `<path class="s-${name}" d="${layer.d}"/>`)
      .join('');
    shore = (lakeH / rows) * 100;
    boat.style.bottom = `${shore * 0.62}%`;
    ripples.forEach((r, i) => {
      r.style.bottom = `${shore * (0.12 + ((i * 7) % 10) * 0.075)}%`;
    });
  }

  // The life of the lake: each thing comes at its own random time, crosses
  // or jumps, and goes. Never two boats at once; never in a hidden window.
  const timers: number[] = [];
  const later = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  const between = (a: number, b: number): number => a + Math.random() * (b - a);
  const quiet = (): boolean => document.hidden || isReduced();

  /** Moves an element across the scene, from one side out to the other. */
  function cross(thing: HTMLElement, seconds: number, toLeft: boolean): Promise<void> {
    const off = `-${thing.offsetWidth + 20}px`;
    const end = 'calc(100% + 20px)';
    thing.classList.toggle('is-left', toLeft);
    thing.classList.add('is-on');
    const run = thing.animate([{ left: toLeft ? end : off }, { left: toLeft ? off : end }], { duration: seconds * 1000, easing: 'linear' });
    return run.finished.then(
      () => thing.classList.remove('is-on'),
      () => thing.classList.remove('is-on'),
    );
  }

  const sail = (): void => {
    if (quiet()) return later(20000, sail);
    void cross(boat, between(80, 120), Math.random() < 0.3).then(() => later(between(20000, 60000), sail));
  };
  const leap = (): void => {
    if (!quiet()) {
      const x = between(8, 90);
      const y = shore * between(0.2, 0.6);
      for (const part of [fish, ring]) {
        part.style.left = `${x}%`;
        part.style.bottom = `${y}%`;
        part.classList.remove('is-on');
        void part.offsetWidth; // start the animation again
        part.classList.add('is-on');
      }
    }
    later(between(9000, 26000), leap);
  };
  const fly = (): void => {
    if (!quiet()) {
      // One to three birds, close together, at the height of the mountains.
      const toLeft = Math.random() < 0.5;
      const count = 1 + Math.floor(Math.random() * 3);
      const height = between(78, 94);
      const seconds = between(24, 38);
      for (let i = 0; i < count; i += 1) {
        const bird = document.createElement('div');
        bird.className = 'sc-bird';
        bird.innerHTML = BIRD;
        bird.style.bottom = `${height - i * 3}%`;
        bird.style.animationDelay = `${-i * 0.2}s`;
        el.append(bird);
        later(i * 700, () => void cross(bird, seconds, toLeft).then(() => bird.remove()));
      }
    }
    later(between(25000, 60000), fly);
  };
  later(between(1500, 4000), sail);
  later(between(4000, 9000), leap);
  later(between(9000, 16000), fly);

  const observer = new ResizeObserver(() => draw());
  observer.observe(el);
  return {
    el,
    dispose: () => {
      observer.disconnect();
      for (const t of timers) window.clearTimeout(t);
      for (const a of el.getAnimations({ subtree: true })) a.cancel();
    },
  };
}
