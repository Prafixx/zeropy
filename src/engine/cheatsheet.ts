// Cheat sheet: every key card of the theory steps on one page, by module,
// with a search. Built from the lesson files, so it grows with the course.
import { place } from '@/kit/motion';
import { course, getLesson, lessonLabel } from './registry';
import { lessonState } from './store';
import { h, icon, sectionHead, mdInline } from './ui';

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
            { class: 'zp-card sheet-card' },
            h('code', { class: 'keycard-code' }, key.code),
            h('span', { class: 'zp-card-text keycard-means' }, mdInline(key.means)),
            h(
              'span',
              { class: 'zp-card-foot' },
              h(
                'a',
                { class: `sheet-from${done ? ' is-done' : ''}`, href: `#/lesson/${lesson.id}`, title: lessonLabel(lesson) },
                done ? icon('check', 14) : null,
                lesson.title,
              ),
            ),
          );
          entries.push({ code: key.code, means: key.means, find: `${key.code} ${key.means} ${lesson.title}`.toLowerCase(), el });
        }
      });
    }
    if (entries.length === 0) return;
    const section = h(
      'section',
      { class: 'zp-section sheet-module' },
      sectionHead(`Module ${m + 1}`, mod.title, `${entries.length} facts`),
      h('div', { class: 'zp-grid' }, ...entries.map((e) => e.el)),
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
    h(
      'main',
      { class: 'player-main', tabindex: '0' },
      h(
        'div',
        { class: 'zp-page sheet' },
        h(
          'header',
          { class: 'zp-page-head', 'data-enter': true },
          h('h1', { class: 'display' }, 'Cheat sheet'),
          h('p', { class: 'lead' }, 'The key facts of every lesson on one page. Search for a word, or open the lesson to learn more.'),
          h('div', { class: 'sheet-tools' }, h('label', { class: 'sheet-search-row' }, icon('search', 20), search), count),
        ),
        empty,
        ...groups.map((g) => g.section),
      ),
    ),
  );
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  search.focus();
  return () => undefined;
}
