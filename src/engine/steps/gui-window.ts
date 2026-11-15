// The window of a tkinter program (pretend tkinter of the harness), drawn
// as HTML. Only widgets that were placed with pack, grid or place are drawn,
// like in real tkinter. A click on a button (or Enter in an entry with a
// <Return> binding) goes back to Python with the text of every entry.
import type { GuiEvent, GuiNode, GuiTree } from '../types';
import { h } from '../ui';

export interface GuiWindow {
  el: HTMLElement;
  /** Draws the window. `fresh`: a new run, so all its dialogs are new. */
  update(tree: GuiTree | null, fresh?: boolean): void;
}

/** A number from a tkinter value like 5, "5" or "(10, 0)" (the first one). */
function px(value: unknown): number {
  const match = /-?\d+(\.\d+)?/.exec(String(value ?? ''));
  return match ? Math.min(60, Math.max(0, Number(match[0]))) : 0;
}

function color(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && CSS.supports('color', text) ? text : null;
}

/** A tkinter font: "Arial 16 bold" or ("Arial", 16, "bold"). */
function applyFont(el: HTMLElement, font: unknown): void {
  const text = String(font ?? '');
  const size = /\b(\d{1,2})\b/.exec(text);
  if (size) el.style.fontSize = `${Math.min(40, Math.max(8, Number(size[1]))) * 1.33}px`;
  if (/bold/.test(text)) el.style.fontWeight = '700';
  if (/italic/.test(text)) el.style.fontStyle = 'italic';
}

function applyStyle(el: HTMLElement, node: GuiNode): void {
  const s = node.style;
  const bg = color(s.bg ?? s.background);
  const fg = color(s.fg ?? s.foreground);
  if (bg) el.style.background = bg;
  if (fg) el.style.color = fg;
  if (s.font) applyFont(el, s.font);
  if (s.width && node.kind !== 'Frame') el.style.minWidth = `${Math.min(60, px(s.width))}ch`;
  if (s.padx) el.style.paddingInline = `${px(s.padx)}px`;
  if (s.pady) el.style.paddingBlock = `${px(s.pady)}px`;
}

/** Where pack and grid put a widget. */
function applyLayout(el: HTMLElement, node: GuiNode): void {
  const l = node.layout;
  if (node.manager === 'grid') {
    el.style.gridRow = `${Number(l.row ?? 0) + 1} / span ${Number(l.rowspan ?? 1)}`;
    el.style.gridColumn = `${Number(l.column ?? 0) + 1} / span ${Number(l.columnspan ?? 1)}`;
    const sticky = String(l.sticky ?? '');
    el.style.justifySelf = sticky.includes('e') && sticky.includes('w') ? 'stretch' : sticky.includes('w') ? 'start' : sticky.includes('e') ? 'end' : 'center';
    el.style.alignSelf = sticky.includes('n') && sticky.includes('s') ? 'stretch' : sticky.includes('n') ? 'start' : sticky.includes('s') ? 'end' : 'center';
  } else {
    const fill = String(l.fill ?? '');
    const side = String(l.side ?? 'top');
    const across = side === 'left' || side === 'right' ? 'y' : 'x';
    el.style.alignSelf = fill === 'both' || fill === across ? 'stretch' : 'center';
    if (l.expand === true || l.expand === 1 || l.expand === 'yes') el.style.flex = '1 1 auto';
  }
  const mx = px(l.padx);
  const my = px(l.pady);
  if (mx || my) el.style.margin = `${my}px ${mx}px`;
}

export function createGuiWindow(onEvent: (event: GuiEvent) => void): GuiWindow {
  const titleEl = h('span', { class: 'gw-title' });
  const body = h('div', { class: 'gw-body' });
  const note = h('p', { class: 'gw-note' });
  const dialogSlot = h('div', { class: 'gw-dialogs' });
  const closeButton = h('button', { type: 'button', class: 'gw-close', 'aria-label': 'Close the window', title: 'Close the window' }, '×');
  const el = h(
    'section',
    { class: 'gw', 'aria-label': 'The window of your program' },
    h('div', { class: 'gw-bar' }, titleEl, closeButton),
    body,
    dialogSlot,
    note,
  );
  const entries = new Map<number, HTMLInputElement>();
  const selections = new Map<number, Set<number>>();
  let seenDialogs = 0;

  function send(event: GuiEvent): void {
    const values: Record<string, string> = {};
    for (const [id, input] of entries) values[id] = input.value;
    const chosen: Record<string, number[]> = {};
    for (const [id, set] of selections) chosen[id] = [...set];
    onEvent({ ...event, values, selections: chosen });
  }
  closeButton.addEventListener('click', () => send({ action: 'close' }));

  function widget(node: GuiNode): HTMLElement | null {
    let el: HTMLElement;
    switch (node.kind) {
      case 'Label':
        el = h('div', { class: 'gw-label' }, node.text ?? '');
        break;
      case 'Button': {
        const b = h('button', { type: 'button', class: 'gw-button' }, node.text || ' ');
        if (node.style.state === 'disabled') b.disabled = true;
        b.addEventListener('click', () => send({ action: 'click', id: node.id }));
        el = b;
        break;
      }
      case 'Checkbutton': {
        const box = h('input', { type: 'checkbox' });
        box.checked = node.checked === true;
        box.addEventListener('click', (event) => {
          event.preventDefault();
          send({ action: 'click', id: node.id });
        });
        el = h('label', { class: 'gw-check' }, box, h('span', null, node.text ?? ''));
        break;
      }
      case 'Entry': {
        const input = h('input', { class: 'gw-entry', type: node.secret ? 'password' : 'text', spellcheck: 'false', 'aria-label': 'Entry' });
        input.value = node.value ?? '';
        if (node.style.width) input.style.width = `${Math.min(60, px(node.style.width)) + 2}ch`;
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && node.keys.includes('<Return>')) send({ action: 'key', id: node.id, key: '<Return>' });
        });
        entries.set(node.id, input);
        el = input;
        break;
      }
      case 'Listbox': {
        const set = new Set(node.selected ?? []);
        selections.set(node.id, set);
        el = h('div', { class: 'gw-list', role: 'listbox' });
        (node.items ?? []).forEach((item, i) => {
          const row = h('div', { class: `gw-item${set.has(i) ? ' is-selected' : ''}`, role: 'option' }, item || ' ');
          row.addEventListener('click', () => {
            set.clear();
            set.add(i);
            el.querySelectorAll('.gw-item').forEach((r, j) => r.classList.toggle('is-selected', j === i));
            if (node.keys.includes('<<ListboxSelect>>')) send({ action: 'select', id: node.id });
          });
          el.append(row);
        });
        break;
      }
      case 'Frame':
        el = h('div', { class: 'gw-frame' });
        fill(el, node.children);
        break;
      default:
        el = h('div', { class: 'gw-label gw-unknown' }, `(${node.kind})`);
    }
    applyStyle(el, node);
    applyLayout(el, node);
    return el;
  }

  /** The placed children of a window or frame, with pack or grid. */
  function fill(container: HTMLElement, nodes: GuiNode[]): void {
    const shown = nodes.filter((n) => n.manager !== null);
    const grid = shown.some((n) => n.manager === 'grid');
    const sides = shown.map((n) => String(n.layout.side ?? 'top'));
    const row = !grid && shown.length > 0 && sides.every((s) => s === 'left' || s === 'right');
    container.classList.add(grid ? 'gw-grid' : row ? 'gw-row' : 'gw-col');
    const ordered = row ? [...shown.filter((_, i) => sides[i] === 'left'), ...shown.filter((_, i) => sides[i] === 'right').reverse()] : shown;
    let firstRight = true;
    for (const node of ordered) {
      const child = widget(node);
      if (!child) continue;
      if (row && String(node.layout.side) === 'right' && firstRight) {
        child.style.marginLeft = 'auto';
        firstRight = false;
      }
      container.append(child);
    }
  }

  function update(tree: GuiTree | null, fresh = false): void {
    entries.clear();
    selections.clear();
    body.replaceChildren();
    body.className = 'gw-body';
    if (fresh) seenDialogs = 0;
    if (!tree) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    titleEl.textContent = tree.title;
    if (tree.closed) {
      body.append(h('p', { class: 'gw-closed' }, 'The window is closed. Press Run to open it again.'));
    } else {
      fill(body, tree.children);
      if (body.children.length === 0) body.append(h('p', { class: 'gw-closed' }, 'The window is empty. Did you pack() the widgets?'));
    }
    note.textContent = tree.looping ? '' : 'mainloop() was not called. On a computer, this window would close at once.';
    note.hidden = tree.looping;
    const fresh_ = tree.dialogs.slice(seenDialogs);
    seenDialogs = tree.dialogs.length;
    dialogSlot.replaceChildren(
      ...fresh_.slice(-1).map((d) => {
        const ok = h('button', { type: 'button', class: 'btn btn-primary btn-small' }, 'OK');
        const dialog = h('div', { class: `gw-dialog is-${d.kind}`, role: 'alertdialog' }, h('strong', null, d.title || 'Message'), h('p', null, d.message), ok);
        ok.addEventListener('click', () => dialog.remove());
        return dialog;
      }),
    );
  }

  return { el, update };
}
