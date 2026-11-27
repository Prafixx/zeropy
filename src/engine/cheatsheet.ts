// Cheat sheet: every key card of the theory steps, by module, with a search.
// Built from the lesson files, so it grows with the course. An index of the
// modules on the left, the facts of one module on the right, as rows: the
// code, what it means, and the lesson it comes from. A search shows the
// matches of every module at once, and marks the modules that have some.
import { place } from '@/kit/motion';
import { course, getLesson, lessonLabel } from './registry';
import { lessonState } from './store';
import { twoPane, type PaneItem } from './two-pane';
import { h, icon, mdInline } from './ui';

interface Entry {
  /** Lower-case text for the search. */
  find: string;
  el: HTMLElement;
}

interface Group {
  id: string;
  title: string;
  kicker: string;
  entries: Entry[];
}

export function mountCheatSheet(root: HTMLElement): () => void {
  const groups: Group[] = [];

  course.modules.forEach((mod, m) => {
    const entries: Entry[] = [];
    for (const ref of mod.lessons) {
      const lesson = getLesson(ref.id);
      if (!lesson) continue;
      const done = lessonState(lesson.id).done;
      lesson.steps.forEach((step) => {
        if (step.type !== 'theory') return;
        for (const key of step.keys ?? []) {
          const el = h(
            'li',
            { class: 'pane-row sheet-row' },
            h('code', { class: 'keycard-code' }, key.code),
            h('span', { class: 'keycard-means' }, mdInline(key.means)),
            h(
              'a',
              { class: `sheet-from${done ? ' is-done' : ''}`, href: `#/lesson/${lesson.id}`, title: lessonLabel(lesson) },
              done ? icon('check', 14) : null,
              lesson.title,
            ),
          );
          entries.push({ find: `${key.code} ${key.means} ${lesson.title}`.toLowerCase(), el });
        }
      });
    }
    if (entries.length) groups.push({ id: `m${m + 1}`, title: mod.title, kicker: `Module ${m + 1}`, entries });
  });

  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  let words: string[] = [];
  const matches = (entry: Entry): boolean => words.every((w) => entry.find.includes(w));
  const empty = (): HTMLElement => h('p', { class: 'sheet-empty' }, 'Nothing matches. Try a shorter word, for example "list" or "len".');

  /** The facts of one module (only the matches while searching). */
  function part(group: Group): HTMLElement {
    const shown = group.entries.filter(matches);
    return h(
      'div',
      { class: 'pane-part sheet-part' },
      h('span', { class: 'kicker' }, group.kicker),
      h('h2', { class: 'pane-title' }, group.title),
      h('p', { class: 'muted' }, words.length ? `${shown.length} of ${group.entries.length} facts match` : `${group.entries.length} key facts`),
      shown.length ? h('ol', { class: 'pane-rows' }, ...shown.map((e) => e.el)) : empty(),
    );
  }

  // The first part: the matches of all modules (or how to search).
  const results: PaneItem = {
    id: 'results',
    label: 'Search results',
    note: 'All modules at once',
    render: () => {
      const hits = groups.map((g) => ({ g, shown: g.entries.filter(matches) })).filter((x) => x.shown.length);
      const count = hits.reduce((n, x) => n + x.shown.length, 0);
      return h(
        'div',
        { class: 'pane-part sheet-part' },
        h('span', { class: 'kicker' }, 'Search'),
        h('h2', { class: 'pane-title' }, words.length ? `${count} of ${total} key facts` : 'Search all modules'),
        words.length ? null : h('p', { class: 'pane-text' }, 'Type a word in the search above, for example append, range or KeyError. The matches of every module show here.'),
        ...(words.length && !count ? [empty()] : []),
        ...(words.length
          ? hits.map(({ g, shown }) => h('section', { class: 'pane-block' }, h('h3', { class: 'pane-subtitle' }, `${g.kicker}: ${g.title}`), h('ol', { class: 'pane-rows' }, ...shown.map((e) => e.el))))
          : []),
      );
    },
  };
  const items: PaneItem[] = [
    results,
    ...groups.map((g, i) => ({
      id: g.id,
      group: i === 0 ? 'By module' : undefined,
      label: g.title,
      note: `${g.kicker} · ${g.entries.length} facts`,
      render: () => part(g),
    })),
  ];
  const pane = twoPane('Modules of the cheat sheet', items, groups[0]?.id);

  const count = h('p', { class: 'muted sheet-count', 'aria-live': 'polite' }, `${total} key facts`);
  const search = h('input', {
    class: 'sheet-search',
    type: 'search',
    placeholder: 'Search, for example: append, range, KeyError',
    'aria-label': 'Search the cheat sheet',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  // Typing shows the matches of all modules; an empty search goes back to
  // the module that was open. A module chosen while searching shows its matches.
  let before = groups[0]?.id ?? 'results';
  search.addEventListener('input', () => {
    const was = words.length > 0;
    words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = groups.reduce((n, g) => n + g.entries.filter(matches).length, 0);
    count.textContent = words.length ? `${shown} of ${total} key facts` : `${total} key facts`;
    pane.mark(words.length ? new Set(['results', ...groups.filter((g) => g.entries.some(matches)).map((g) => g.id)]) : null);
    if (words.length && !was) {
      if (pane.current() !== 'results') before = pane.current();
      pane.select('results');
    } else if (!words.length) pane.select(before);
    else pane.select(pane.current());
  });

  const page = h(
    'div',
    { class: 'player' },
    h(
      'main',
      { class: 'player-main', tabindex: '0' },
      h(
        'div',
        { class: 'zp-page pane-page sheet' },
        h(
          'header',
          { class: 'zp-page-head', 'data-enter': true },
          h('h1', { class: 'display' }, 'Cheat sheet'),
          h('p', { class: 'lead' }, 'The key facts of every lesson. Search for a word, or pick a module.'),
          h('div', { class: 'sheet-tools' }, h('label', { class: 'sheet-search-row' }, icon('search', 20), search), count),
        ),
        h('div', { class: 'pane-wrap', 'data-enter': true }, pane.el),
      ),
    ),
  );
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  search.focus();
  return () => undefined;
}
