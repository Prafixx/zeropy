// The layout of the pages with many parts (Mixed practice, Knowledge, Cheat
// sheet, After the course): an index on the left, one part on the right.
// The panel fits the window, so the page itself does not scroll and no box is
// ever cut by the edge of the window; a long part scrolls inside its panel,
// and its edge fades instead of cutting. On a phone the index is a row of
// chips above the part.
import { h } from './ui';

export interface PaneItem {
  id: string;
  /** The name in the index. */
  label: string;
  /** A small line under the name: a count, a state. */
  note?: string;
  /** Something small on the right of the name: a meter, a badge. */
  extra?: HTMLElement | null;
  /** The heading of the group this item starts in the index. */
  group?: string;
  /** Draws the part, when it is chosen. */
  render: () => HTMLElement;
}

export interface TwoPane {
  el: HTMLElement;
  /** The chosen part. */
  current(): string;
  /** Chooses a part (and draws it). */
  select(id: string, focus?: boolean): void;
  /** Marks parts in the index (search: which parts have matches). */
  mark(ids: Set<string> | null): void;
}

export function twoPane(label: string, items: PaneItem[], initial?: string): TwoPane {
  const body = h('div', { class: 'pane-body', role: 'tabpanel', tabindex: '0' });
  const buttons = new Map<string, HTMLButtonElement>();
  const nav = h('div', { class: 'pane-nav', role: 'tablist', 'aria-label': label, 'aria-orientation': 'vertical' });
  let chosen = '';

  for (const item of items) {
    if (item.group) nav.append(h('span', { class: 'pane-group kicker' }, item.group));
    const button = h(
      'button',
      { type: 'button', class: 'pane-tab', role: 'tab', id: `pane-${item.id}`, 'aria-selected': 'false' },
      h('span', { class: 'pane-tab-text' }, h('strong', null, item.label), item.note ? h('small', null, item.note) : null),
      item.extra ?? null,
    );
    button.addEventListener('click', () => select(item.id, false));
    buttons.set(item.id, button);
    nav.append(button);
  }

  // The arrow keys move through the index, like real tabs.
  nav.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const ids = items.map((i) => i.id);
    let at = ids.indexOf(chosen);
    if (event.key === 'Home') at = 0;
    else if (event.key === 'End') at = ids.length - 1;
    else at = (at + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    select(ids[at], true);
  });

  // A part longer than its panel: the edge fades while there is more below.
  const fade = (): void => {
    body.classList.toggle('has-more', body.scrollHeight - body.scrollTop - body.clientHeight > 4);
  };
  body.addEventListener('scroll', fade, { passive: true });
  new ResizeObserver(fade).observe(body);

  function select(id: string, focus = false): void {
    const item = items.find((i) => i.id === id) ?? items[0];
    if (!item) return;
    chosen = item.id;
    for (const [key, button] of buttons) {
      const on = key === item.id;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      button.classList.toggle('is-current', on);
    }
    body.setAttribute('aria-labelledby', `pane-${item.id}`);
    body.replaceChildren(item.render());
    body.scrollTop = 0;
    requestAnimationFrame(fade);
    const button = buttons.get(item.id);
    if (focus) button?.focus();
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function mark(ids: Set<string> | null): void {
    for (const [key, button] of buttons) {
      button.classList.toggle('is-dim', ids !== null && !ids.has(key));
      button.classList.toggle('is-hit', ids !== null && ids.has(key));
    }
  }

  select(initial ?? items[0]?.id ?? '');
  return { el: h('div', { class: 'pane' }, nav, body), current: () => chosen, select, mark };
}
