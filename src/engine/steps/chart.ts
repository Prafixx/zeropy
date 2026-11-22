// Draws the figures of a program that used matplotlib.pyplot (src/py/plot.py)
// as SVG: lines, points, bars and histograms, with axes, ticks, labels, a grid
// and a legend. All text is set with textContent, never as markup.
import type { ChartFigure, ChartSeries } from '../types';
import { h } from '../ui';

const NS = 'http://www.w3.org/2000/svg';
const W = 480;
const H = 300;
const PAD = { left: 54, right: 16, top: 34, bottom: 46 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Round tick steps (1, 2, 2.5, 5 times a power of ten), about five ticks. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

function label(n: number): string {
  if (Math.abs(n) >= 10000 || (n !== 0 && Math.abs(n) < 0.001)) return n.toExponential(1);
  return String(Number(n.toPrecision(6)));
}

/** The range of the data, with 5% more on each side (matplotlib's margins); bars start at 0. */
function range(values: number[], fromZero: boolean, fixed: [number, number] | null): [number, number] {
  if (fixed) return fixed;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) return [0, 1];
  if (fromZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const margin = (hi - lo) * 0.05;
  return [fromZero && lo === 0 ? 0 : lo - margin, fromZero && hi === 0 ? 0 : hi + margin];
}

function dash(style?: string | null): string | null {
  return style === '--' ? '6 4' : style === ':' ? '2 3' : style === '-.' ? '6 3 2 3' : null;
}

function marker(kind: string, x: number, y: number, color: string): SVGElement {
  if (kind === 's') return svg('rect', { x: x - 3.5, y: y - 3.5, width: 7, height: 7, fill: color });
  if (kind === '^' || kind === 'v') {
    const d = kind === '^' ? `M${x} ${y - 4.5} L${x + 4.5} ${y + 3.5} L${x - 4.5} ${y + 3.5} Z` : `M${x} ${y + 4.5} L${x + 4.5} ${y - 3.5} L${x - 4.5} ${y - 3.5} Z`;
    return svg('path', { d, fill: color });
  }
  if (kind === 'x' || kind === '+') {
    const d = kind === 'x' ? `M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x - 4} ${y + 4} L${x + 4} ${y - 4}` : `M${x - 4.5} ${y} L${x + 4.5} ${y} M${x} ${y - 4.5} L${x} ${y + 4.5}`;
    return svg('path', { d, stroke: color, 'stroke-width': 2, fill: 'none' });
  }
  return svg('circle', { cx: x, cy: y, r: kind === '.' ? 2 : 3.5, fill: color });
}

function describe(fig: ChartFigure): string {
  const kinds: Record<ChartSeries['kind'], string> = { line: 'line', scatter: 'set of points', bar: 'set of bars', hist: 'histogram' };
  const parts = fig.series.map((s) => `${kinds[s.kind]}${s.label ? ` "${s.label}"` : ''} with ${s.y.length} values`);
  return `Chart${fig.title ? ` "${fig.title}"` : ''}: ${parts.join(', ')}.${fig.xlabel ? ` Across: ${fig.xlabel}.` : ''}${fig.ylabel ? ` Up: ${fig.ylabel}.` : ''}`;
}

export function drawChart(fig: ChartFigure): HTMLElement {
  // Names as x values (bars, or a line over days): one place per name, in order.
  const named = fig.series.filter((s) => s.kind === 'bar' || (s.x ?? []).some((v) => typeof v === 'string'));
  const names = [...new Set(named.flatMap((s) => (s.x ?? []).map(String)))];
  const categorical = names.length > 0;
  const xs: number[] = [];
  const ys: number[] = [...fig.lines.map((l) => l.y)];
  for (const s of fig.series) {
    if (s.kind === 'hist') xs.push(...(s.edges ?? []));
    else if (!named.includes(s)) xs.push(...(s.x ?? []).map(Number));
    ys.push(...s.y);
  }
  const fromZero = fig.series.some((s) => s.kind === 'bar' || s.kind === 'hist');
  const [x0, x1] = categorical ? [-0.6, names.length - 0.4] : range(xs, false, fig.xlim);
  const [y0, y1] = range(ys, fromZero, fig.ylim);
  const px = (x: number) => PAD.left + ((x - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const py = (y: number) => H - PAD.bottom - ((y - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': describe(fig) });
  root.append(svg('title', {}, describe(fig)));
  const plotArea = { x: PAD.left, y: PAD.top, w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };
  root.append(svg('rect', { x: plotArea.x, y: plotArea.y, width: plotArea.w, height: plotArea.h, class: 'chart-frame' }));

  // Ticks, and the grid.
  const yTicks = niceTicks(y0, y1).filter((t) => t >= y0 - 1e-9 && t <= y1 + 1e-9);
  for (const t of yTicks) {
    if (fig.grid) root.append(svg('line', { x1: plotArea.x, x2: plotArea.x + plotArea.w, y1: py(t), y2: py(t), class: 'chart-grid' }));
    root.append(svg('line', { x1: plotArea.x - 4, x2: plotArea.x, y1: py(t), y2: py(t), class: 'chart-axis' }));
    root.append(svg('text', { x: plotArea.x - 7, y: py(t) + 4, class: 'chart-tick', 'text-anchor': 'end' }, label(t)));
  }
  const xTicks: [number, string][] = categorical ? names.map((n, i) => [i, n]) : niceTicks(x0, x1).filter((t) => t >= x0 - 1e-9 && t <= x1 + 1e-9).map((t) => [t, label(t)]);
  for (const [t, text] of xTicks) {
    if (fig.grid) root.append(svg('line', { x1: px(t), x2: px(t), y1: plotArea.y, y2: plotArea.y + plotArea.h, class: 'chart-grid' }));
    root.append(svg('line', { x1: px(t), x2: px(t), y1: plotArea.y + plotArea.h, y2: plotArea.y + plotArea.h + 4, class: 'chart-axis' }));
    root.append(svg('text', { x: px(t), y: plotArea.y + plotArea.h + 17, class: 'chart-tick', 'text-anchor': 'middle' }, text.length > 10 ? `${text.slice(0, 9)}…` : text));
  }

  // The data, clipped to the plot area.
  const clipId = `clip-${Math.random().toString(36).slice(2)}`;
  const clip = svg('clipPath', { id: clipId });
  clip.append(svg('rect', { x: plotArea.x, y: plotArea.y, width: plotArea.w, height: plotArea.h }));
  root.append(clip);
  const data = svg('g', { 'clip-path': `url(#${clipId})` });
  root.append(data);
  for (const s of fig.series) {
    if (s.kind === 'bar') {
      const width = ((W - PAD.left - PAD.right) / (x1 - x0)) * 0.8;
      (s.x ?? []).forEach((name, i) => {
        const cx = px(names.indexOf(String(name)));
        const top = py(Math.max(s.y[i], 0));
        const bottom = py(Math.min(s.y[i], 0));
        data.append(svg('rect', { x: cx - width / 2, y: top, width, height: Math.max(0, bottom - top), fill: s.color }));
      });
    } else if (s.kind === 'hist') {
      const edges = s.edges ?? [];
      s.y.forEach((count, i) => {
        const left = px(edges[i]);
        const right = px(edges[i + 1]);
        data.append(svg('rect', { x: left, y: py(count), width: Math.max(0, right - left), height: Math.max(0, py(0) - py(count)), fill: s.color, class: 'chart-hist' }));
      });
    } else {
      const points = (s.x ?? []).map((x, i) => [px(typeof x === 'string' ? names.indexOf(x) : Number(x)), py(s.y[i])] as const);
      if (s.kind === 'line' && s.style) {
        const attrs: Record<string, string | number> = { points: points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), stroke: s.color, 'stroke-width': 2, fill: 'none' };
        const d = dash(s.style);
        if (d) attrs['stroke-dasharray'] = d;
        data.append(svg('polyline', attrs));
      }
      const mark = s.kind === 'scatter' ? s.marker || 'o' : s.marker;
      if (mark) points.forEach(([x, y], i) => data.append(marker(mark, x, y, s.colors?.[i] ?? s.color)));
    }
  }
  for (const l of fig.lines) {
    const attrs: Record<string, string | number> = { x1: plotArea.x, x2: plotArea.x + plotArea.w, y1: py(l.y), y2: py(l.y), stroke: l.color, 'stroke-width': 1.5 };
    const d = dash(l.style);
    if (d) attrs['stroke-dasharray'] = d;
    data.append(svg('line', attrs));
  }

  // Title and axis labels.
  if (fig.title) root.append(svg('text', { x: PAD.left + plotArea.w / 2, y: 20, class: 'chart-title', 'text-anchor': 'middle' }, fig.title));
  if (fig.xlabel) root.append(svg('text', { x: PAD.left + plotArea.w / 2, y: H - 8, class: 'chart-label', 'text-anchor': 'middle' }, fig.xlabel));
  if (fig.ylabel) root.append(svg('text', { x: 14, y: PAD.top + plotArea.h / 2, class: 'chart-label', 'text-anchor': 'middle', transform: `rotate(-90 14 ${PAD.top + plotArea.h / 2})` }, fig.ylabel));

  // The legend, at the top right inside the plot.
  const entries = [...fig.series.filter((s) => s.label).map((s) => ({ label: s.label!, color: s.color })), ...fig.lines.filter((l) => l.label).map((l) => ({ label: l.label!, color: l.color }))];
  if (fig.legend && entries.length) {
    const box = svg('g', { class: 'chart-legend' });
    const longest = Math.max(...entries.map((e) => e.label.length));
    const bw = Math.min(200, 30 + longest * 7);
    const bx = plotArea.x + plotArea.w - bw - 6;
    box.append(svg('rect', { x: bx, y: plotArea.y + 6, width: bw, height: 8 + entries.length * 17, class: 'chart-legend-box' }));
    entries.forEach((e, i) => {
      const y = plotArea.y + 20 + i * 17;
      box.append(svg('rect', { x: bx + 8, y: y - 8, width: 14, height: 9, fill: e.color }));
      box.append(svg('text', { x: bx + 28, y, class: 'chart-tick' }, e.label.length > 24 ? `${e.label.slice(0, 23)}…` : e.label));
    });
    root.append(box);
  }
  return h('figure', { class: 'chart' }, root as unknown as HTMLElement);
}
