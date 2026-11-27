// "My knowledge": how well the learner knows each objective, from their
// answers (knowledge.ts), and the lessons they skipped. The weakest topics
// get a practice button; any lesson can be skipped or included again.
import { place } from '@/kit/motion';
import { effective, LEVEL_NAME, levelOf } from './knowledge';
import type { Level } from './knowledge';
import { course, getLesson, lessonLabel } from './registry';
import { includeLesson, isSkipped, knowledgeOf, lessonState, skipLesson } from './store';
import type { Lesson } from './types';
import { h, icon, panel } from './ui';
import { twoPane, type PaneItem, type TwoPane } from './two-pane';

const ORDER: Level[] = ['mastered', 'solid', 'learning', 'weak', 'new'];

interface Topic {
  lesson: Lesson;
  id: string;
  text: string;
  level: Level;
  p: number;
}

function topicsOf(lesson: Lesson): Topic[] {
  return lesson.objectives.map((o) => {
    const state = knowledgeOf(lesson.id, o.id);
    return { lesson, id: o.id, text: o.text, level: levelOf(state), p: state ? effective(state) : 0 };
  });
}

function badge(level: Level): HTMLElement {
  return h('span', { class: `know-badge is-${level}` }, LEVEL_NAME[level]);
}

/** One bar for a group of topics: a part for each level, with the counts in words. */
function bar(topics: Topic[]): HTMLElement {
  const counts = ORDER.map((level) => ({ level, n: topics.filter((t) => t.level === level).length }));
  const words = counts.filter((c) => c.n > 0).map((c) => `${c.n} ${LEVEL_NAME[c.level].toLowerCase()}`).join(', ');
  return h(
    'div',
    { class: 'know-bar', role: 'img', 'aria-label': words || 'No topics' },
    ...counts.filter((c) => c.n > 0).map((c) => h('i', { class: `is-${c.level}`, style: `flex-grow: ${c.n}` })),
  );
}

function practiceLink(topic: Topic, label = 'Practice'): HTMLElement {
  return h(
    'a',
    { class: 'btn btn-plain btn-small', href: `#/practice/topic/${topic.lesson.id}/${topic.id}` },
    h('span', { class: 'btn-label' }, label),
    icon('right', 16),
  );
}

export function mountKnowledge(root: HTMLElement): () => void {
  const body = h('div', { class: 'step-body' });
  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      h('main', { class: 'player-main is-page', tabindex: '0' }, body),
    ),
  );

  function lessonRow(lesson: Lesson): HTMLElement {
    const skipped = isSkipped(lesson.id);
    const topics = topicsOf(lesson);
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-ghost btn-small know-skip',
        'aria-pressed': String(skipped),
        title: skipped ? 'Count this lesson again' : 'Take this lesson out of your next steps, reviews and practice',
      },
      h('span', { class: 'btn-label' }, skipped ? 'Include' : 'Skip'),
    );
    toggle.addEventListener('click', (event) => {
      // The button sits in the summary: a click must not also open or close the lesson.
      event.preventDefault();
      event.stopPropagation();
      if (skipped) includeLesson(lesson.id);
      else skipLesson(lesson.id);
      render(lesson.id);
    });
    const state = lessonState(lesson.id);
    return h(
      'details',
      { class: `know-lesson${skipped ? ' is-skipped' : ''}`, 'data-lesson': lesson.id },
      h(
        'summary',
        null,
        // Only the number: "Lesson 13" is 13, "Computer 2" is 2 (the path is in the heading).
        h('span', { class: 'know-num' }, lessonLabel(lesson).replace(/^\D+/, '')),
        h(
          'span',
          { class: 'know-title' },
          h('strong', null, lesson.title),
          h('small', null, skipped ? 'Skipped' : state.done ? 'Done' : state.reached > 0 ? 'Started' : 'Not started'),
        ),
        skipped ? h('span', { class: 'know-dots' }) : h('span', { class: 'know-dots', 'aria-hidden': 'true' }, ...topics.map((t) => h('i', { class: `is-${t.level}` }))),
        toggle,
      ),
      h(
        'ul',
        { class: 'know-topics' },
        ...topics.map((t) =>
          h('li', null, h('span', null, t.text), skipped ? null : badge(t.level), skipped || t.level === 'new' ? null : practiceLink(t)),
        ),
        h(
          'li',
          { class: 'know-open' },
          h('a', { href: `#/lesson/${lesson.id}` }, skipped ? 'Open the lesson anyway' : state.done ? 'Open the lesson again' : 'Open the lesson'),
        ),
      ),
    );
  }

  let pane: TwoPane | null = null;

  function render(keepOpen?: string): void {
    // The Python modules, then the modules of each path ("Linux: The terminal").
    const groups = [
      ...course.modules.map((m, i) => ({ num: String(i + 1), path: '', title: m.title, lessons: m.lessons })),
      ...(course.paths ?? []).flatMap((p) => p.modules.map((m) => ({ num: '', path: p.title, title: m.title, lessons: m.lessons }))),
    ];
    const lessons = groups.flatMap((g) => g.lessons.map((e) => getLesson(e.id))).filter((l): l is Lesson => Boolean(l));
    const counted = lessons.filter((l) => !isSkipped(l.id)).flatMap(topicsOf);
    const weakest = counted
      .filter((t) => t.level === 'weak' || t.level === 'learning')
      .sort((a, b) => a.p - b.p)
      .slice(0, 3);
    const skippedCount = lessons.filter((l) => isSkipped(l.id)).length;

    const tiles = ORDER.map((level) =>
      h('div', { class: `zp-card know-tile is-${level}` }, h('b', null, String(counted.filter((t) => t.level === level).length)), h('span', null, LEVEL_NAME[level])),
    );

    // The first part: how it stands, and what to practice now.
    const overview: PaneItem = {
      id: 'overview',
      label: 'Overview',
      note: `${counted.filter((t) => t.level !== 'new').length} of ${counted.length} topics practiced`,
      render: () =>
        h(
          'div',
          { class: 'pane-part knowledge-part' },
          h('span', { class: 'kicker' }, 'All your topics'),
          h('h2', { class: 'pane-title' }, 'How it stands'),
          h('div', { class: 'zp-grid know-tiles' }, ...tiles),
          h('h3', { class: 'pane-subtitle' }, 'Practice your weakest topics'),
          weakest.length
            ? h(
                'ol',
                { class: 'pane-rows' },
                ...weakest.map((t) =>
                  h('li', { class: 'pane-row' }, h('span', { class: 'pane-row-text' }, h('strong', null, t.text), h('small', null, `From ${t.lesson.title}`)), h('span', { class: 'pane-row-end' }, badge(t.level), practiceLink(t))),
                ),
              )
            : panel(
                'info',
                counted.some((t) => t.level !== 'new') ? 'No weak topics right now.' : 'Nothing to show yet.',
                counted.some((t) => t.level !== 'new') ? 'Everything you practiced is solid or better. Keep going with the next lesson.' : 'Answer questions in the lessons, and your topics appear here.',
              ),
          skippedCount
            ? h('p', { class: 'muted' }, `You skipped ${skippedCount} lesson${skippedCount === 1 ? '' : 's'}: ${skippedCount === 1 ? 'it does' : 'they do'} not count here.`)
            : null,
        ),
    };

    // Then one part for each module: its lessons, each one opens to its topics.
    const modules: PaneItem[] = groups.map((m, i) => {
      const own = m.lessons.map((e) => getLesson(e.id)).filter((l): l is Lesson => Boolean(l));
      const topics = own.filter((l) => !isSkipped(l.id)).flatMap(topicsOf);
      const known = topics.filter((t) => t.level !== 'new').length;
      const first = i === 0 ? 'Python' : m.path && groups[i - 1].path !== m.path ? m.path : undefined;
      return {
        id: `m${i}`,
        group: first,
        label: m.title,
        note: `${m.path ? 'Path' : `Module ${m.num}`} · ${own.length} lessons`,
        extra: bar(topics),
        render: () =>
          h(
            'div',
            { class: 'pane-part knowledge-part' },
            h('span', { class: 'kicker' }, m.path || `Module ${m.num}`),
            h('h2', { class: 'pane-title' }, m.title),
            h('div', { class: 'pane-line' }, bar(topics), h('span', { class: 'muted' }, `${known} of ${topics.length} topics practiced`)),
            h('div', { class: 'know-lessons pane-rows' }, ...own.map(lessonRow)),
          ),
      };
    });

    const items = [overview, ...modules];
    // A lesson changed (skipped or included): stay on its module, open it again.
    const keep = keepOpen ? `m${groups.findIndex((g) => g.lessons.some((e) => e.id === keepOpen))}` : pane?.current();
    pane = twoPane('Parts of my knowledge', items, keep);
    body.replaceChildren(
      h(
        'div',
        { class: 'zp-page pane-page knowledge' },
        h('header', { class: 'zp-page-head', 'data-enter': true }, h('h1', { class: 'display' }, 'My knowledge'), h('p', { class: 'lead' }, 'How well you know each topic, from your answers.')),
        h('div', { class: 'pane-wrap', 'data-enter': true }, pane.el),
      ),
    );
    if (keepOpen) {
      const open = body.querySelector<HTMLDetailsElement>(`details[data-lesson="${keepOpen}"]`);
      if (open) {
        open.open = true;
        open.querySelector('summary')?.focus();
      }
      return;
    }
    place(body.querySelectorAll('[data-enter]'));
  }

  render();
  return () => undefined;
}
