// The sky behind every page: pixel stars, placed like a real sky (clusters,
// a faint band, empty patches), never on a grid. Three layers drift up
// slowly at three speeds, so the sky has depth. A few quiet things live in
// it: faint dithered clouds (nebulas), four star pictures of Python, and now
// and then a shooting star. They sit behind the content: cards and panels cover
// them, the empty space shows them. Reduced motion: the same sky, still.

interface Star {
  x: number; // 0..100 (% of the width)
  y: number; // 0..100 (% of the height)
  kind: 'dot' | 'big' | 'spark';
  tone: 'w' | 'a' | 'b';
  o: number; // base opacity
}

/** A small seeded random, so the sky is the same on every start. */
function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Stars for a w x h area: clusters, a diagonal band, a thin rest; with gaps. */
function makeStars(w: number, h: number, seed: number, density = 1): Star[] {
  const rnd = random(seed);
  const gauss = (): number => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const count = Math.round(((w * h) / 9500) * density);
  const clusters = Array.from({ length: 5 }, () => ({ x: rnd() * w, y: rnd() * h, r: 60 + rnd() * 140 }));
  const out: Star[] = [];
  const near = (x: number, y: number): boolean => out.some((s) => Math.abs((s.x / 100) * w - x) < 14 && Math.abs((s.y / 100) * h - y) < 14);
  let tries = 0;
  while (out.length < count && tries++ < count * 30) {
    const pick = rnd();
    let x: number;
    let y: number;
    if (pick < 0.4) {
      const c = clusters[Math.floor(rnd() * clusters.length)];
      x = c.x + gauss() * c.r;
      y = c.y + gauss() * c.r;
    } else if (pick < 0.7) {
      // The band: from the lower left to the upper right.
      const t = rnd();
      x = t * w + gauss() * 70;
      y = (1 - t) * h * 0.9 + gauss() * 90;
    } else {
      x = rnd() * w;
      y = rnd() * h;
    }
    if (x < 0 || y < 0 || x > w || y > h || near(x, y)) continue;
    const k = rnd();
    const t = rnd();
    out.push({
      x: (x / w) * 100,
      y: (y / h) * 100,
      kind: k < 0.76 ? 'dot' : k < 0.93 ? 'big' : 'spark',
      tone: t < 0.76 ? 'w' : t < 0.9 ? 'a' : 'b',
      o: 0.35 + rnd() * 0.55,
    });
  }
  return out;
}

function starEl(s: Star, rnd: () => number): HTMLElement {
  const el = document.createElement('i');
  // Only some stars twinkle (and every sparkle glints): calm, and light work
  // for a modest PC.
  const still = s.kind !== 'spark' && rnd() > 0.35;
  el.className = `star star-${s.kind} tone-${s.tone}${still ? ' is-still' : ''}`;
  el.style.left = `${s.x}%`;
  el.style.top = `${s.y / 2}%`; // the layer is twice as tall as the screen
  el.style.setProperty('--o', s.o.toFixed(2));
  el.style.setProperty('--d', `${(2.6 + rnd() * 4.8).toFixed(2)}s`);
  el.style.animationDelay = `${(-rnd() * 8).toFixed(2)}s`;
  return el;
}

// Ordered dithering (Bayer 4 x 4): the pixel-art way to draw a soft edge.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number): number => (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;

/** An SVG of pixels: `cells(x, y)` names the class of each pixel, or ''. */
function pixels(cols: number, rows: number, cell: number, cells: (x: number, y: number) => string): SVGSVGElement {
  const byClass = new Map<string, string>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells(x, y);
      if (c) byClass.set(c, `${byClass.get(c) ?? ''}M${x} ${y}h1v1h-1z`);
    }
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
  svg.setAttribute('width', String(cols * cell));
  svg.setAttribute('height', String(rows * cell));
  svg.setAttribute('shape-rendering', 'crispEdges');
  for (const [c, d] of byClass) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('class', c);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** A star picture: stars joined by a dotted pixel line; the last star is amber. */
function figure(strokes: [number, number][][]): () => SVGSVGElement {
  return () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const all = strokes.flat();
    const w = Math.max(...all.map((p) => p[0])) + 6;
    const hh = Math.max(...all.map((p) => p[1])) + 6;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(hh));
    svg.setAttribute('shape-rendering', 'crispEdges');
    for (const points of strokes) {
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', points.map(([x, y]) => `${x + 3},${y + 3}`).join(' '));
      svg.append(line);
    }
    all.forEach(([x, y], i) => {
      const head = i === all.length - 1;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('class', head ? 'f-head' : 'f-star');
      r.setAttribute('x', String(x + (head ? 0 : 1)));
      r.setAttribute('y', String(y + (head ? 0 : 1)));
      r.setAttribute('width', head ? '6' : '4');
      r.setAttribute('height', head ? '6' : '4');
      svg.append(r);
    });
    return svg;
  };
}

// Star pictures of Python: a snake (a python), the prompt >>>, the brackets
// of a list [ ] and the # of a comment. Placed in a cross over the screen
// (top right, lower left, top left, lower right), so the sky stays balanced.
const SNAKE = [Array.from({ length: 9 }, (_, i) => [i * 26, Math.round(26 + Math.sin(i * 0.9) * 22)] as [number, number])];
const PROMPT = [0, 1, 2].map((i) => [[i * 30, 0], [i * 30 + 18, 18], [i * 30, 36]] as [number, number][]);
const LIST: [number, number][][] = [
  [[12, 0], [0, 0], [0, 18], [0, 36], [12, 36]],
  [[40, 0], [52, 0], [52, 18], [52, 36], [40, 36]],
];
const HASH: [number, number][][] = [
  [[20, 0], [12, 56]],
  [[44, 0], [36, 56]],
  [[0, 18], [62, 18]],
  [[0, 38], [58, 38]],
];

/** A nebula: a faint cloud of dithered pixels, thinner at the edge. */
function nebula(cols: number, rows: number, seed: number): SVGSVGElement {
  const rnd = random(seed);
  const blobs = Array.from({ length: 4 }, () => ({ x: (0.25 + rnd() * 0.5) * cols, y: (0.3 + rnd() * 0.4) * rows, r: (0.16 + rnd() * 0.14) * cols }));
  return pixels(cols, rows, 4, (x, y) => {
    // Fades to nothing at the border, so the cloud never shows a straight edge.
    const fade = Math.sin((Math.PI * (x + 0.5)) / cols) * Math.sin((Math.PI * (y + 0.5)) / rows);
    const v = blobs.reduce((sum, b) => sum + Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r)), 0) * 0.6 * fade;
    const t = bayer(x, y);
    if (v > t + 0.45) return 'n-core';
    return v > t ? 'n-edge' : '';
  });
}

/** A thing of the sky at (x %, y %) of the screen, in a layer twice as tall. */
function thing(layer: HTMLElement, svg: () => SVGSVGElement, className: string, x: number, y: number): void {
  // Twice: the second half of the layer repeats the first, so the drift loops.
  for (const top of [y / 2, y / 2 + 50]) {
    const el = document.createElement('i');
    el.className = `sky-thing ${className}`;
    el.style.left = `${x}%`;
    el.style.top = `${top}%`;
    el.append(svg());
    layer.append(el);
  }
}

let shootTimer = 0;

/** A shooting star now and then: a short pixel streak, high in the sky. */
function shootingStars(sky: HTMLElement, rnd: () => number): void {
  const el = document.createElement('i');
  el.className = 'shooting-star';
  sky.append(el);
  const next = (): void => {
    shootTimer = window.setTimeout(
      () => {
        if (document.documentElement.dataset.motion !== 'reduced' && !document.hidden) {
          el.style.left = `${30 + rnd() * 60}%`;
          el.style.top = `${4 + rnd() * 30}%`;
          el.classList.remove('is-going');
          void el.offsetWidth; // start the animation again
          el.classList.add('is-going');
        }
        next();
      },
      14000 + rnd() * 16000,
    );
  };
  next();
}

/** Puts the sky behind the app (once). */
export function mountSky(): void {
  if (document.querySelector('.sky')) return;
  const sky = document.createElement('div');
  sky.className = 'sky';
  sky.setAttribute('aria-hidden', 'true');
  const w = Math.max(window.screen.width, 1280);
  const h = Math.max(window.screen.height, 800);
  const rnd = random(11);
  const [far, mid] = (['far', 'mid', 'near'] as const).map((name, i) => {
    const layer = document.createElement('div');
    layer.className = `sky-layer sky-${name}`;
    for (const s of makeStars(w, h, 31 + i, [1.2, 0.77, 0.4][i])) layer.append(starEl(s, rnd), starEl({ ...s, y: s.y + 100 }, rnd));
    sky.append(layer);
    return layer;
  });
  // Far: two faint clouds. Then the star pictures, in the open parts of
  // most pages.
  thing(far, () => nebula(60, 32, 5), 'sky-nebula tone-b', 56, 58);
  thing(far, () => nebula(46, 26, 9), 'sky-nebula tone-v', 4, 12);
  thing(mid, figure(SNAKE), 'sky-figure', 74, 10);
  thing(far, figure(PROMPT), 'sky-figure is-2', 19, 76);
  thing(mid, figure(LIST), 'sky-figure is-3', 34, 7);
  thing(far, figure(HASH), 'sky-figure is-4', 82, 80);
  shootingStars(sky, rnd);
  document.body.prepend(sky);
}

export function unmountSky(): void {
  window.clearTimeout(shootTimer);
  document.querySelector('.sky')?.remove();
}
