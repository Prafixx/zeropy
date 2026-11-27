// The frame of every page outside a lesson: a sidebar with the navigation on
// the left (on a phone: a tab bar at the bottom), the page on the right.
// Lessons do not use it: they open in focus mode, full screen.
import { brand, settingsButton } from './settings-menu';
import { dueCards, mistakes } from './store';
import { h, icon } from './ui';

export type Place = 'course' | 'review' | 'practice' | 'mistakes' | 'knowledge' | 'playground' | 'cheatsheet' | 'next';

interface Item {
  id: Place;
  label: string;
  icon: string;
  href: string;
  /** Shown in the phone tab bar; the others are under "More". */
  tab?: boolean;
}

const LEARN: Item[] = [
  { id: 'course', label: 'Course', icon: 'home', href: '#/', tab: true },
  { id: 'review', label: 'Review', icon: 'loop', href: '#/review', tab: true },
  { id: 'practice', label: 'Practice', icon: 'mix', href: '#/practice', tab: true },
  { id: 'mistakes', label: 'Mistakes', icon: 'target', href: '#/mistakes' },
  { id: 'knowledge', label: 'Knowledge', icon: 'bars', href: '#/knowledge', tab: true },
];
const TOOLS: Item[] = [
  { id: 'playground', label: 'Playground', icon: 'code', href: '#/playground' },
  { id: 'cheatsheet', label: 'Cheat sheet', icon: 'book', href: '#/cheatsheet' },
  { id: 'next', label: 'After the course', icon: 'flag', href: '#/next' },
];

export interface Shell {
  /** The element a page draws itself into. */
  page: HTMLElement;
  /** Marks the current place and updates the counts. */
  show(place: Place): void;
  remove(): void;
}

export function createShell(root: HTMLElement): Shell {
  const links = new Map<Place, HTMLAnchorElement[]>();
  const counts = new Map<Place, HTMLElement[]>();

  function link(item: Item, kind: 'side' | 'tab'): HTMLAnchorElement {
    const count = h('span', { class: 'nav-count', hidden: true });
    const el = h(
      'a',
      // The label is also a tooltip: the folded menu shows only the icons.
      { class: `${kind}-link`, href: item.href, title: item.label },
      icon(item.icon, kind === 'tab' ? 22 : 20),
      h('span', { class: `${kind}-label` }, item.label),
      count,
    );
    if (kind === 'side') el.addEventListener('click', () => closeMore());
    links.set(item.id, [...(links.get(item.id) ?? []), el]);
    counts.set(item.id, [...(counts.get(item.id) ?? []), count]);
    return el;
  }

  const side = h(
    'aside',
    { class: 'side', 'aria-label': 'ZeroPy' },
    h('div', { class: 'side-brand' }, brand()),
    h('nav', { class: 'side-nav', 'aria-label': 'Learn' }, ...LEARN.map((item) => link(item, 'side'))),
    h(
      'nav',
      { class: 'side-nav', 'aria-label': 'Tools' },
      h('span', { class: 'side-heading' }, 'Tools'),
      ...TOOLS.map((item) => link(item, 'side')),
    ),
    h('div', { class: 'side-foot' }, settingsButton({ side: true })),
  );

  // Phone: four places as tabs, the rest (and Settings) under "More".
  const more = h('button', { type: 'button', class: 'tab-link', 'aria-expanded': 'false' }, icon('menu', 22), h('span', { class: 'tab-label' }, 'More'));
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Main' }, ...LEARN.filter((i) => i.tab).map((item) => link(item, 'tab')), more);
  const scrim = h('div', { class: 'side-scrim', hidden: true });
  function closeMore(): void {
    app.classList.remove('is-more');
    more.setAttribute('aria-expanded', 'false');
    scrim.hidden = true;
  }
  more.addEventListener('click', () => {
    const open = !app.classList.contains('is-more');
    app.classList.toggle('is-more', open);
    more.setAttribute('aria-expanded', String(open));
    scrim.hidden = !open;
  });
  scrim.addEventListener('click', closeMore);

  const page = h('div', { class: 'app-page' });
  const top = h('header', { class: 'app-top' }, brand());
  // The pin: a small tab on the edge of the menu. It keeps the menu open
  // until it is pressed again. It is not saved: the app starts folded.
  const pin = h('button', { type: 'button', class: 'side-pin', 'aria-pressed': 'false', 'aria-label': 'Keep the menu open', title: 'Keep the menu open' }, h('i'), h('i'), h('i'));
  const app = h('div', { class: 'app' }, side, pin, scrim, top, page, tabs);

  // Wide windows: the menu is a rail of icons that opens under the pointer,
  // over the page (the page keeps room for it: nothing moves, nothing hides).
  const wide = window.matchMedia('(min-width: 1081px)');
  let openTimer = 0;
  let closeTimer = 0;
  const menuOpen = (): boolean => Boolean(side.querySelector('.menu:not([hidden])'));
  const setOpen = (open: boolean): void => {
    app.classList.toggle('is-open', open && wide.matches);
  };
  const enter = (): void => {
    window.clearTimeout(closeTimer);
    openTimer = window.setTimeout(() => setOpen(true), 90);
  };
  const leave = (): void => {
    window.clearTimeout(openTimer);
    closeTimer = window.setTimeout(() => {
      if (!app.classList.contains('is-pinned') && !menuOpen() && !side.contains(document.activeElement)) setOpen(false);
    }, 280);
  };
  for (const part of [side, pin]) {
    part.addEventListener('pointerenter', enter);
    part.addEventListener('pointerleave', leave);
  }
  side.addEventListener('focusin', () => setOpen(true));
  side.addEventListener('focusout', leave);
  // A click outside the menu (also after the Settings menu closes) folds it.
  document.addEventListener('pointerdown', (event) => {
    if (!app.isConnected || app.classList.contains('is-pinned')) return;
    if (!side.contains(event.target as Node) && !pin.contains(event.target as Node)) leave();
  });
  pin.addEventListener('click', () => {
    const pinned = !app.classList.contains('is-pinned');
    app.classList.toggle('is-pinned', pinned);
    pin.setAttribute('aria-pressed', String(pinned));
    const text = pinned ? 'Let the menu fold again' : 'Keep the menu open';
    pin.setAttribute('aria-label', text);
    pin.title = text;
    setOpen(pinned || side.matches(':hover'));
  });
  wide.addEventListener('change', () => setOpen(app.classList.contains('is-pinned')));
  root.replaceChildren(app);

  return {
    page,
    show(place) {
      closeMore();
      for (const [id, els] of links) {
        for (const el of els) {
          el.classList.toggle('is-current', id === place);
          if (id === place) el.setAttribute('aria-current', 'page');
          else el.removeAttribute('aria-current');
        }
      }
      const number: Partial<Record<Place, number>> = { review: dueCards().length, mistakes: mistakes().length };
      for (const [id, els] of counts) {
        const n = number[id] ?? 0;
        for (const el of els) {
          el.hidden = n === 0;
          el.textContent = n > 99 ? '99+' : String(n);
        }
      }
      // "More" is current when the page lives under it.
      more.classList.toggle('is-current', !LEARN.some((i) => i.tab && i.id === place));
      page.scrollTo({ top: 0 });
    },
    remove() {
      app.remove();
    },
  };
}
