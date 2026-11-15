// Small DOM helpers shared by all views.
import { marked } from 'marked';

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

const ICONS: Record<string, string> = {
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
  bulb: '<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 117 0c-.7.6-1 1.2-1 2H9.5c0-.8-.3-1.4-1-2z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  loop: '<path d="M4 12a8 8 0 0113.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

export function icon(name: keyof typeof ICONS | string, size = 20): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
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
    code.replaceChildren(...words.flatMap((word, i) => [...(i > 0 ? [' '] : []), h('span', { class: 'nowrap' }, word)]));
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
