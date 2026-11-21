// "My knowledge": how well the learner knows each objective, from their
// answers (knowledge.ts), and the lessons they skipped. The weakest topics
// get a practice button; any lesson can be skipped or included again.
import { place } from '@/kit/motion';
import { effective, LEVEL_NAME, levelOf } from './knowledge';
import type { Level } from './knowledge';
import { pageBar } from './playground';
import { course, getLesson, lessonLabel } from './registry';
import { includeLesson, isSkipped, knowledgeOf, lessonState, skipLesson } from './store';
import type { Lesson } from './types';
import { h, icon, panel } from './ui';

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
  const home = h('a', { class: 'btn btn-ghost', href: '#/' }, h('span', { class: 'btn-label' }, 'Back to the course'));
  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      pageBar('My knowledge', 'What you know, topic by topic'),
      h('main', { class: 'player-main', tabindex: '0' }, body),
      h('footer', { class: 'dock' }, home, h('div', { class: 'dock-note' })),
    ),
  );

  function lessonRow(lesson: Lesson): HTMLElement {
    const skipped = isSkipped(lesson.id);
    const topics = topicsOf(lesson);
    const toggle = h(
      'button',
      { type: 'button', class: 'btn btn-ghost btn-small know-skip', 'aria-pressed': String(skipped) },
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
        h('span', { class: 'know-num' }, lessonLabel(lesson).replace(/^Lesson /, '')),
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

  function render(keepOpen?: string): void {
    // The Python modules, then the modules of each path ("Linux: The terminal").
    const groups = [
      ...course.modules.map((m, i) => ({ num: String(i + 1).padStart(2, '0'), title: m.title, lessons: m.lessons })),
      ...(course.paths ?? []).flatMap((p) => p.modules.map((m) => ({ num: p.short, title: m.title, lessons: m.lessons }))),
    ];
    const lessons = groups.flatMap((g) => g.lessons.map((e) => getLesson(e.id))).filter((l): l is Lesson => Boolean(l));
    const counted = lessons.filter((l) => !isSkipped(l.id)).flatMap(topicsOf);
    const weakest = counted
      .filter((t) => t.level === 'weak' || t.level === 'learning')
      .sort((a, b) => a.p - b.p)
      .slice(0, 3);
    const skippedCount = lessons.filter((l) => isSkipped(l.id)).length;

    const tiles = ORDER.map((level) =>
      h('div', { class: `know-tile is-${level}` }, h('b', null, String(counted.filter((t) => t.level === level).length)), h('span', null, LEVEL_NAME[level])),
    );

    const modules = groups.map((m) => {
      const own = m.lessons.map((e) => getLesson(e.id)).filter((l): l is Lesson => Boolean(l));
      return h(
        'section',
        { class: 'know-module' },
        h(
          'div',
          { class: 'know-module-head' },
          h('span', { class: 'module-num' }, m.num),
          h('h2', null, m.title),
          bar(own.filter((l) => !isSkipped(l.id)).flatMap(topicsOf)),
        ),
        ...own.map(lessonRow),
      );
    });

    body.replaceChildren(
      h(
        'div',
        { class: 'single knowledge' },
        h('h1', { class: 'display', 'data-enter': true }, 'My knowledge'),
        h(
          'p',
          { class: 'lead', 'data-enter': true },
          'An estimate from your answers: every question, exercise, table and review card counts. Right on the first try counts more. Without practice, a topic slowly drops again, so it comes back before you forget it.',
        ),
        h('div', { class: 'know-tiles', 'data-enter': true }, ...tiles),
        h('h2', { class: 'sheet-title', 'data-enter': true }, 'Practice your weakest topics'),
        weakest.length
          ? h(
              'ul',
              { class: 'know-weak', 'data-enter': true },
              ...weakest.map((t) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'mistake-where' }, `${lessonLabel(t.lesson)} · ${t.lesson.title}`),
                  h('strong', null, t.text),
                  badge(t.level),
                  practiceLink(t),
                ),
              ),
            )
          : h(
              'div',
              { 'data-enter': true },
              panel('info', counted.some((t) => t.level !== 'new') ? 'No weak topics right now.' : 'Nothing to show yet.', counted.some((t) => t.level !== 'new') ? 'Everything you practiced is solid or better. Keep going with the next lesson.' : 'Answer questions in the lessons, and your topics appear here.'),
            ),
        h('h2', { class: 'sheet-title', 'data-enter': true }, 'All topics'),
        h(
          'p',
          { class: 'muted', 'data-enter': true },
          `Open a lesson to see its topics. "Skip" takes a lesson out of your next steps, reviews and practice, and out of these numbers.${skippedCount ? ` You skipped ${skippedCount} lesson${skippedCount === 1 ? '' : 's'}.` : ''}`,
        ),
        ...modules,
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
