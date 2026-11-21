// Cheat sheet: every key card of the theory steps on one page, by module,
// with a search. Built from the lesson files, so it grows with the course.
import { place } from '@/kit/motion';
import { pageBar } from './playground';
import { course, getLesson, lessonLabel } from './registry';
import { lessonState } from './store';
import { h, icon, mdInline } from './ui';

interface Entry {
  code: string;
  means: string;
  /** Lower-case text for the search. */
  find: string;
  el: HTMLElement;
}

export function mountCheatSheet(root: HTMLElement): () => void {
  const groups: { section: HTMLElement; entries: Entry[] }[] = [];

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
            'div',
            { class: 'sheet-card' },
            h('code', { class: 'keycard-code' }, key.code),
            h('span', { class: 'keycard-means' }, mdInline(key.means)),
            h(
              'a',
              { class: `sheet-from${done ? ' is-done' : ''}`, href: `#/lesson/${lesson.id}` },
              done ? icon('check', 14) : null,
              `${lessonLabel(lesson)} · ${lesson.title}`,
            ),
          );
          entries.push({ code: key.code, means: key.means, find: `${key.code} ${key.means} ${lesson.title}`.toLowerCase(), el });
        }
      });
    }
    if (entries.length === 0) return;
    const section = h(
      'section',
      { class: 'sheet-module' },
      h('h2', { class: 'sheet-title' }, h('span', { class: 'sheet-num' }, String(m + 1)), mod.title),
      h('div', { class: 'sheet-grid' }, ...entries.map((e) => e.el)),
    );
    groups.push({ section, entries });
  });

  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const count = h('p', { class: 'muted sheet-count', 'aria-live': 'polite' }, `${total} key facts`);
  const empty = h('p', { class: 'sheet-empty', hidden: true }, 'Nothing matches. Try a shorter word, for example "list" or "len".');
  const search = h('input', {
    class: 'sheet-search',
    type: 'search',
    placeholder: 'Search, for example: append, range, KeyError',
    'aria-label': 'Search the cheat sheet',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  search.addEventListener('input', () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const group of groups) {
      let inGroup = 0;
      for (const entry of group.entries) {
        const match = words.every((w) => entry.find.includes(w));
        entry.el.hidden = !match;
        if (match) inGroup += 1;
      }
      group.section.hidden = inGroup === 0;
      shown += inGroup;
    }
    empty.hidden = shown > 0;
    count.textContent = words.length ? `${shown} of ${total} key facts` : `${total} key facts`;
  });

  const page = h(
    'div',
    { class: 'player' },
    pageBar('Cheat sheet', 'Every key fact'),
    h(
      'main',
      { class: 'player-main', tabindex: '0' },
      h(
        'div',
        { class: 'sheet' },
        h('h1', { class: 'display', 'data-enter': true }, 'Cheat sheet'),
        h('p', { class: 'lead', 'data-enter': true }, 'The key facts of every lesson on one page. Search for a word, or open the lesson to learn more.'),
        h('label', { class: 'sheet-search-row', 'data-enter': true }, icon('search', 20), search),
        count,
        empty,
        ...groups.map((g) => g.section),
      ),
    ),
    h('footer', { class: 'dock' }, h('a', { class: 'btn btn-ghost', href: '#/' }, h('span', { class: 'btn-label' }, 'Back to the course')), h('div', { class: 'dock-note' })),
  );
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  search.focus();
  return () => undefined;
}
