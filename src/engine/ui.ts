// Small DOM helpers shared by all views.
import { marked } from 'marked';
import { MASCOT_SVG, PIXEL_ICONS } from '@/kit/pixel-art';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown> | null;

/** Creates an element. Keys starting with "on" are event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/**
 * A pixel icon (src/kit/pixel-art.ts, 12x12). The size snaps to whole
 * pixels of the drawing (12, 24 or 36 px), so every pixel stays sharp.
 */
export function icon(name: string, size = 20): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  const px = size <= 18 ? 12 : size <= 28 ? 24 : 36;
  span.innerHTML = `<svg viewBox="0 0 12 12" width="${px}" height="${px}" fill="currentColor" shape-rendering="crispEdges">${PIXEL_ICONS[name] ?? ''}</svg>`;
  return span;
}

/** The crate mascot, `size` px square. */
export function mascot(size: number, className = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `mascot ${className}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.innerHTML = MASCOT_SVG.replace('<svg ', `<svg width="${size}" height="${size}" `);
  return span;
}

export interface CodeBlock {
  el: HTMLElement;
  lines: HTMLElement[];
  setActive(line: number | null): void;
}

/** Static, highlighted Python code. Highlighting arrives when the chunk loads. */
export function codeBlock(code: string, options: { numbers?: boolean } = {}): CodeBlock {
  const source = code.replace(/\n+$/, '');
  const lines = source.split('\n').map((text, i) => {
    const line = h('span', { class: 'code-text' }, text || '​');
    const row = h(
      'div',
      { class: 'code-line' },
      options.numbers ? h('span', { class: 'code-num', 'aria-hidden': 'true' }, String(i + 1)) : null,
      line,
    );
    return { row, line };
  });
  const el = h('pre', { class: 'code' }, ...lines.map((l) => l.row));
  void import('@/editor/editor').then((m) =>
    m.highlightLines(
      lines.map((l) => l.line),
      source,
    ),
  );
  return {
    el,
    lines: lines.map((l) => l.row),
    setActive(line) {
      lines.forEach((l, i) => l.row.classList.toggle('is-active', line === i + 1));
    },
  };
}

/** A link to another site (for example the Python docs) opens in a new tab, so the lesson stays open. */
function openOutside(el: HTMLElement): HTMLElement {
  el.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  return el;
}

/** Renders Markdown written by lesson authors (trusted content). */
export function md(source: string, className = 'prose'): HTMLElement {
  const el = openOutside(h('div', { class: className, html: marked.parse(source, { async: false }) }));
  el.querySelectorAll('pre').forEach((pre) => {
    // A block marked as text (for example an error message) stays plain.
    if (pre.querySelector('code.language-text')) {
      pre.replaceWith(h('pre', { class: 'traceback' }, (pre.textContent ?? '').replace(/\n+$/, '')));
      return;
    }
    pre.replaceWith(codeBlock(pre.textContent ?? '').el);
  });
  wrapLongCode(el);
  return el;
}

/** One line of Markdown without a wrapping paragraph. */
export function mdInline(source: string): HTMLElement {
  return wrapLongCode(openOutside(h('span', { html: marked.parseInline(source, { async: false }) })));
}

/**
 * Inline code stays on one line, but a long piece of code (or any code in a
 * narrow table cell) may wrap, only at its spaces: "git log --oneline" must
 * never break after "--", and a long line must not leave its column.
 */
function wrapLongCode(el: HTMLElement): HTMLElement {
  el.querySelectorAll('code').forEach((code) => {
    if (code.closest('pre')) return;
    const text = code.textContent ?? '';
    if (!code.closest('td') && text.length <= 24) return;
    code.classList.add('is-long');
    if (!text.includes(' ')) {
      // No spaces, like Path("a.txt").write_text("x"): it may break after a dot.
      const parts = text.split(/(?<=\.)/);
      code.replaceChildren(...parts.flatMap((part, i) => [...(i > 0 ? [h('wbr')] : []), part]));
      return;
    }
    const words = text.split(' ');
    // A very long word (like ValueError(f"{book.title}) may also break after a dot.
    const piece = (word: string): Node[] =>
      word.length > 18 && word.includes('.')
        ? word.split(/(?<=\.)/).flatMap((part, i) => [...(i > 0 ? [h('wbr')] : []), h('span', { class: 'nowrap' }, part)])
        : [h('span', { class: 'nowrap' }, word)];
    code.replaceChildren(...words.flatMap((word, i) => [...(i > 0 ? [' '] : []), ...piece(word)]));
  });
  return el;
}

export type PanelKind = 'good' | 'bad' | 'info';

/** Feedback panel. Meaning is carried by icon and words, not only by color. */
export function panel(kind: PanelKind, title: string, ...body: Child[]): HTMLElement {
  const iconName = kind === 'good' ? 'check' : kind === 'bad' ? 'cross' : 'bulb';
  return h(
    'div',
    { class: `panel panel-${kind}`, role: 'status' },
    h('div', { class: 'panel-icon' }, icon(iconName, 18)),
    h('div', { class: 'panel-body' }, h('strong', { class: 'panel-title' }, title), ...body),
  );
}

/**
 * An empty page or a finished set: a quiet icon, a title, one sentence and
 * at most two actions, in the middle of the page.
 */
export function emptyState(_iconName: string, title: string, text: string, ...actions: (HTMLElement | null)[]): HTMLElement {
  return h(
    'div',
    { class: 'empty-state', role: 'status' },
    mascot(64, 'empty-icon'),
    h('h2', { class: 'empty-title' }, title),
    h('p', { class: 'empty-text' }, text),
    actions.some(Boolean) ? h('div', { class: 'empty-actions' }, ...actions) : null,
  );
}

export function button(
  label: string,
  options: { kind?: 'primary' | 'ghost' | 'plain'; icon?: string; small?: boolean; onClick?: () => void } = {},
): HTMLButtonElement {
  const el = h(
    'button',
    {
      type: 'button',
      class: `btn btn-${options.kind ?? 'plain'}${options.small ? ' btn-small' : ''}`,
      onclick: options.onClick,
    },
    h('span', { class: 'btn-label' }, label),
    options.icon ? icon(options.icon, 18) : null,
  );
  return el;
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The head of a section of cards (the shared card system, app.css "zp-"):
 * a tiny label, the title, and a note on the right (a count, a state).
 */
export function sectionHead(kicker: string, title: string, note?: string | HTMLElement | null): HTMLElement {
  return h(
    'div',
    { class: 'zp-section-head' },
    h('div', null, kicker ? h('span', { class: 'kicker' }, kicker) : null, h('h2', { class: 'zp-section-title' }, title)),
    note ? h('span', { class: 'zp-section-note' }, note) : null,
  );
}
