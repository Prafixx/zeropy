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
      { class: `${kind}-link`, href: item.href },
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
  const app = h('div', { class: 'app' }, side, scrim, top, page, tabs);
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
