// Home: an app home. A returning learner sees today first (continue, review,
// mistakes, progress), then the course map. A first visit gets a short
// welcome with a live example instead.
import { landscape } from '@/kit/landscape';
import { place } from '@/kit/motion';
import { course, getLesson, lessons } from './registry';
import { lessonAvailable, pathStatus, paths } from './paths';
import { dueCards, isSkipped, lessonState, mistakes, openPath } from './store';
import type { CourseModule } from './types';
import { backButton, h, icon, mascot } from './ui';
import { twoPane, type PaneItem } from './two-pane';
import { APP_VERSION } from './updates';

/** `view`: 'start' is the first screen only; 'course' is the map of the course. */
export function mountHome(root: HTMLElement, view: 'start' | 'course' = 'start'): () => void {
  const available = lessons();
  // The next lesson: not done, not skipped, and not in a path that is still closed.
  const current = available.find((l) => !lessonState(l.id).done && lessonAvailable(l)) ?? available[0];
  const started = current ? lessonState(current.id).reached > 0 : false;
  const due = dueCards().length;
  const missed = mistakes().length;

  // Hours from the lessons themselves, so the numbers always agree.
  const minutesOf = (ids: string[]): number => ids.reduce((sum, id) => sum + (getLesson(id)?.minutes ?? 0), 0);
  const hours = (minutes: number): string => String(Math.round((minutes / 60) * 2) / 2);

  const doneIn = (ids: string[]): number => ids.filter((id) => lessonState(id).done).length;
  const progressBar = (done: number, all: number): HTMLElement =>
    h('span', { class: 'meter', role: 'img', 'aria-label': `${done} of ${all} done` }, h('i', { style: `width: ${all ? (100 * done) / all : 0}%` }));


  const pythonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const anyProgress = available.some((l) => lessonState(l.id).reached > 0 || lessonState(l.id).done);
  const doneCount = doneIn(pythonIds);

  /** One number of today: big, with what it counts under it. */
  const stat = (href: string, value: string, label: string, hot: boolean, extra?: HTMLElement): HTMLElement =>
    h('a', { class: `today-stat${hot ? ' is-hot' : ''}`, href }, h('b', null, value), h('span', null, label), extra ?? null);

  /** A returning learner: what to do now. */
  function today(): HTMLElement[] {
    const steps = current ? current.steps.length : 0;
    const at = current ? Math.min(lessonState(current.id).reached + 1, steps) : 0;
    return [
      h(
        'section',
        { class: 'today', 'aria-label': 'Today' },
        current
          ? h(
              'div',
              { class: 'today-card today-continue', 'data-enter': true },
              mascot(128, 'today-mascot'),
              h('span', { class: 'kicker' }, started ? 'Continue where you stopped' : 'Your next lesson'),
              h('h1', { class: 'today-title' }, current.title),
              h('p', { class: 'muted' }, current.summary),
              h(
                'div',
                { class: 'today-progress' },
                progressBar(started ? at - 1 : 0, steps),
                h('span', { class: 'muted small' }, started ? `Step ${at} of ${steps}` : `About ${current.minutes} minutes`),
              ),
              h(
                'div',
                { class: 'hero-actions' },
                h(
                  'a',
                  { class: 'btn btn-primary btn-big', href: `#/lesson/${current.id}` },
                  h('span', { class: 'btn-label' }, started ? 'Continue' : 'Start the lesson'),
                  icon('right', 20),
                ),
                h('a', { class: 'btn btn-big', href: '#/course' }, h('span', { class: 'btn-label' }, 'See the course')),
              ),
            )
          : null,
        h(
          'div',
          { class: 'today-stats', 'data-enter': true },
          stat('#/review', String(due), due === 1 ? 'card to review' : 'cards to review', due > 0),
          stat('#/mistakes', String(missed), missed === 1 ? 'mistake to practice' : 'mistakes to practice', false),
          stat('#/knowledge', `${doneCount}/${pythonIds.length}`, 'lessons done', false, progressBar(doneCount, pythonIds.length)),
        ),
      ),
    ];
  }

  /** A first visit: the claim and the way in, over the pixel scene of the lake. */
  function welcome(): HTMLElement[] {
    // Two parts, each with its own soft light: one light over the whole title
    // and a moving word inside it made Chromium draw the word twice.
    const claim = h('h1', { class: 'landing-claim' }, h('span', { class: 'landing-lit' }, 'Code your first program'), ' ', h('em', null, 'today.'));
    const start = current
      ? h('a', { class: 'btn btn-primary btn-big', href: `#/lesson/${current.id}` }, h('span', { class: 'btn-label' }, 'Start the first lesson'), icon('right', 20))
      : null;
    return [
      h(
        'section',
        { class: 'landing' },
        claim,
        h('div', { class: 'landing-actions' }, start, h('a', { class: 'btn btn-big', href: '#/course' }, h('span', { class: 'btn-label' }, 'See the course'))),
      ),
    ];
  }

  /** A lesson as a row: its name, its state, and the way in. */
  const lessonRow = (entry: CourseModule['lessons'][number]): HTMLElement => {
    const lesson = getLesson(entry.id);
    const project = entry.kind === 'project' ? ' · project' : '';
    if (!lesson) return h('li', { class: 'pane-row is-locked' }, h('span', { class: 'pane-row-text' }, h('strong', null, entry.title), h('small', null, `Coming later${project}`)), icon('lock', 16));
    const state = lessonState(lesson.id);
    const skipped = isSkipped(lesson.id);
    const note = skipped ? 'You skipped it' : state.done ? 'Done' : state.reached > 0 ? 'Started' : 'Not started';
    return h(
      'li',
      { class: `pane-row course-row${state.done ? ' is-done' : ''}${lesson.id === current?.id ? ' is-next' : ''}` },
      h('span', { class: 'pane-row-text' }, h('strong', null, state.done ? h('span', { class: 'course-check' }, icon('check', 14)) : null, entry.title), h('small', null, `${note} · ${lesson.minutes} min${project}`)),
      h('a', { class: `btn btn-small ${lesson.id === current?.id ? 'btn-primary' : 'btn-plain'}`, href: `#/lesson/${lesson.id}` }, h('span', { class: 'btn-label' }, state.done ? 'Again' : state.reached > 0 ? 'Continue' : 'Start'), icon('right', 16)),
    );
  };

  /** The modules, the outcomes and the paths: an index and one panel. */
  function courseMap(): HTMLElement {
    const items: PaneItem[] = course.modules.map((module, m) => {
      const ids = module.lessons.map((l) => l.id);
      const done = doneIn(ids);
      return {
        id: `module-${m + 1}`,
        group: m === 0 ? 'Python' : undefined,
        label: module.title,
        note: `Module ${m + 1} · ${done} of ${ids.length} · ${hours(minutesOf(ids))} h`,
        extra: progressBar(done, ids.length),
        render: () =>
          h(
            'div',
            { class: 'pane-part' },
            h('span', { class: 'kicker' }, `Module ${m + 1}`),
            h('h2', { class: 'pane-title' }, module.title),
            h('p', { class: 'pane-text' }, module.goal),
            h('div', { class: 'pane-line' }, progressBar(done, ids.length), h('span', { class: 'muted' }, `${done} of ${ids.length} lessons done`), h('span', { class: 'module-hours' }, icon('clock', 14), `${hours(minutesOf(ids))} h`)),
            h('ol', { class: 'pane-rows' }, ...module.lessons.map(lessonRow)),
            done ? h('a', { class: 'btn btn-plain btn-small', href: `#/practice/${m + 1}` }, icon('mix', 16), h('span', { class: 'btn-label' }, 'Mixed practice of this module')) : null,
          ),
      };
    });
    items.push({
      id: 'outcomes',
      group: 'At the end',
      label: 'What you can do, alone',
      note: `${course.outcomes.length} skills`,
      render: () =>
        h(
          'div',
          { class: 'pane-part' },
          h('span', { class: 'kicker' }, 'At the end of the course'),
          h('h2', { class: 'pane-title' }, 'You can, alone:'),
          h('ul', { class: 'pane-rows' }, ...course.outcomes.map((text) => h('li', { class: 'pane-row' }, h('span', { class: 'pane-row-text course-outcome' }, icon('check', 16), h('span', null, text))))),
          h('a', { class: 'btn btn-plain btn-small', href: '#/next' }, h('span', { class: 'btn-label' }, 'And after the course?'), icon('right', 16)),
        ),
    });
    // Paths after Python: open when their Python lessons are ready, or by hand.
    paths().forEach((path, i) => {
      const status = pathStatus(path);
      const minutes = minutesOf(path.modules.flatMap((m) => m.lessons.map((l) => l.id)));
      items.push({
        id: `path-${path.id}`,
        group: i === 0 ? 'Paths after Python' : undefined,
        label: path.title,
        note: `${status.open ? 'Open' : 'Closed for now'} · ${hours(minutes)} h`,
        extra: status.open ? null : icon('lock', 16),
        render: () => {
          const openAnyway = h('button', { type: 'button', class: 'btn btn-plain btn-small' }, h('span', { class: 'btn-label' }, 'Open it anyway'), icon('right', 16));
          openAnyway.addEventListener('click', () => {
            openPath(path.id);
            // Draw the page again, with the path open.
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          });
          return h(
            'div',
            { class: 'pane-part' },
            h('span', { class: 'kicker' }, 'A path after Python'),
            h('h2', { class: 'pane-title' }, path.title),
            h('p', { class: 'pane-text' }, path.goal),
            h('div', { class: 'pane-line' }, h('span', { class: 'module-hours' }, icon('clock', 14), `${hours(minutes)} h`), h('span', { class: 'muted' }, status.open ? 'Open' : 'Closed for now')),
            ...(status.open
              ? path.modules.map((module) => h('section', { class: 'pane-block' }, h('h3', { class: 'pane-subtitle' }, module.title), h('ol', { class: 'pane-rows' }, ...module.lessons.map(lessonRow))))
              : [
                  h('p', { class: 'pane-text' }, `It opens when these Python lessons are done and their topics are not weak (${status.needs.filter((n) => n.ready).length} of ${status.needs.length} ready):`),
                  h(
                    'ol',
                    { class: 'pane-rows' },
                    ...status.needs.map((n) =>
                      h('li', { class: 'pane-row' }, h('span', { class: 'pane-row-text' }, h('strong', null, n.lesson.title), h('small', null, n.ready ? 'Ready' : 'Not ready yet')), h('a', { class: 'btn btn-plain btn-small', href: `#/lesson/${n.lesson.id}` }, h('span', { class: 'btn-label' }, 'Open'), icon('right', 16))),
                    ),
                  ),
                  h('div', { class: 'path-open' }, openAnyway, h('span', { class: 'muted small' }, 'You decide: the path opens now, and the Python lessons stay where they are.')),
                ]),
          );
        },
      });
    });
    // The module of the next lesson is open first.
    const at = course.modules.findIndex((m) => m.lessons.some((l) => l.id === current?.id));
    return h(
      'div',
      { class: 'zp-page pane-page course-map', id: 'course' },
      h(
        'header',
        { class: 'zp-page-head', 'data-enter': true },
        h('div', { class: 'page-back' }, backButton('Back', '#/')),
        h('h1', { class: 'display' }, 'The course'),
        h('p', { class: 'lead' }, `${course.modules.length} modules, ${pythonIds.length} lessons. Each module ends with a project.`),
      ),
      h('div', { class: 'pane-wrap', 'data-enter': true }, twoPane('Modules and paths of the course', items, at >= 0 ? `module-${at + 1}` : undefined).el),
    );
  }

  // The footer belongs to the course page: the first screen shows the hero alone.
  const footer = h(
    'footer',
    { class: 'foot' },
    h(
      'div',
      { class: 'foot-inner' },
      h('span', null, `ZeroPy ${APP_VERSION}`),
      h('span', null, 'Made by Prafix, with AI assistance'),
      h('span', null, 'Your progress stays on this device'),
      h('a', { href: 'THIRD-PARTY-NOTICES.txt', target: '_blank', rel: 'noopener' }, 'Licenses'),
    ),
  );
  const page =
    view === 'course'
      ? h('div', { class: 'home' }, h('main', { class: 'home-main' }, courseMap()), footer)
      : h('div', { class: 'home' }, h('main', { class: 'home-main home-start' }, ...(anyProgress ? today() : welcome())));

  // A first visit: the pixel scene at the foot of the page.
  const scene = view === 'start' && !anyProgress ? landscape() : null;
  if (scene) {
    page.classList.add('has-scene');
    page.append(scene.el);
  }
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));

  return () => {
    scene?.dispose();
  };
}
