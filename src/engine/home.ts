// Home: an app home. A returning learner sees today first (continue, review,
// mistakes, progress), then the course map. A first visit gets a short
// welcome with a live example instead.
import { Boxes2D } from '@/kit/actors/variable-boxes-2d';
import type { BoxVar } from '@/kit/actors/variable-boxes';
import { finished, isReduced, place, sleep } from '@/kit/motion';
import { course, getLesson, lessons } from './registry';
import { lessonAvailable, pathStatus, paths } from './paths';
import { dueCards, isSkipped, lessonState, mistakes, openPath } from './store';
import type { CourseModule } from './types';
import { codeBlock, h, icon, mascot } from './ui';
import { APP_VERSION } from './updates';

const HERO_CODE = 'price = 4\nquantity = 3\ntotal = price * quantity\nquantity = 10';
const HERO_STATES: { vars: BoxVar[]; from?: Record<string, string> }[] = [
  { vars: [{ name: 'price', type: 'int', repr: '4' }] },
  { vars: [{ name: 'price', type: 'int', repr: '4' }, { name: 'quantity', type: 'int', repr: '3' }] },
  {
    vars: [
      { name: 'price', type: 'int', repr: '4' },
      { name: 'quantity', type: 'int', repr: '3' },
      { name: 'total', type: 'int', repr: '12' },
    ],
    from: { total: 'price' },
  },
  {
    vars: [
      { name: 'price', type: 'int', repr: '4' },
      { name: 'quantity', type: 'int', repr: '10' },
      { name: 'total', type: 'int', repr: '12' },
    ],
  },
];

export function mountHome(root: HTMLElement): () => void {
  let alive = true;
  const available = lessons();
  // The next lesson: not done, not skipped, and not in a path that is still closed.
  const current = available.find((l) => !lessonState(l.id).done && lessonAvailable(l)) ?? available[0];
  const started = current ? lessonState(current.id).reached > 0 : false;
  const due = dueCards().length;
  const missed = mistakes().length;

  // Hero demo: the product in ten seconds, built from the same actor as lessons.
  const heroCode = codeBlock(HERO_CODE, { numbers: true });
  const heroStage = h('div', { class: 'stage2d hero-stage' });
  const boxes = new Boxes2D({ mode: '2d', el: heroStage, dispose: () => undefined });

  async function loop(): Promise<void> {
    await sleep(700);
    while (alive) {
      await finished(boxes.sync([]));
      for (let i = 0; i < HERO_STATES.length && alive; i += 1) {
        heroCode.setActive(i + 1);
        await finished(boxes.sync(HERO_STATES[i].vars, { from: HERO_STATES[i].from }));
        await sleep(900);
      }
      if (isReduced()) return;
      await sleep(2600);
      heroCode.setActive(null);
    }
  }

  // Hours from the lessons themselves, so the numbers always agree.
  const minutesOf = (ids: string[]): number => ids.reduce((sum, id) => sum + (getLesson(id)?.minutes ?? 0), 0);
  const hours = (minutes: number): string => String(Math.round((minutes / 60) * 2) / 2);
  const totalMinutes = minutesOf(course.modules.flatMap((m) => m.lessons.map((l) => l.id)));

  /** The lessons of a module as chips. `practice`: the link to its mixed practice. */
  const lessonChips = (module: CourseModule, practice?: string): HTMLElement =>
    h(
      'ol',
      { class: 'module-lessons' },
      ...module.lessons.map((entry) => {
        const lesson = getLesson(entry.id);
        const kind = entry.kind === 'project' ? ' is-project' : '';
        if (!lesson) {
          return h('li', { class: `chip is-locked${kind}` }, icon('lock', 13), h('span', null, entry.title));
        }
        const state = lessonState(lesson.id);
        const skipped = isSkipped(lesson.id);
        return h(
          'li',
          null,
          h(
            'a',
            {
              class: `chip is-open${state.done ? ' is-done' : ''}${skipped ? ' is-skipped' : ''}${kind}`,
              href: `#/lesson/${lesson.id}`,
              title: skipped ? 'You skipped this lesson' : null,
            },
            icon(skipped ? 'skip' : state.done ? 'check' : 'play', 13),
            h('span', null, entry.title),
            h('small', null, skipped ? 'skipped' : `${lesson.minutes} min`),
          ),
        );
      }),
      // Mixed practice of the module, once one of its lessons is done.
      practice && module.lessons.some((entry) => lessonState(entry.id).done)
        ? h('li', null, h('a', { class: 'chip is-open is-practice', href: practice }, icon('mix', 13), h('span', null, 'Mixed practice')))
        : null,
    );

  const doneIn = (ids: string[]): number => ids.filter((id) => lessonState(id).done).length;
  const progressBar = (done: number, all: number): HTMLElement =>
    h('span', { class: 'meter', role: 'img', 'aria-label': `${done} of ${all} done` }, h('i', { style: `width: ${all ? (100 * done) / all : 0}%` }));

  const modules = course.modules.map((module, m) => {
    const ids = module.lessons.map((l) => l.id);
    const done = doneIn(ids);
    return h(
      'section',
      { class: `module${ids.includes(current?.id ?? '') ? ' is-current' : ''}` },
      h(
        'div',
        { class: 'module-head' },
        h('div', null, h('span', { class: 'kicker' }, `Module ${m + 1}`), h('h3', null, module.title), h('p', null, module.goal)),
        h(
          'div',
          { class: 'module-meta' },
          h('span', null, `${done} of ${ids.length}`),
          progressBar(done, ids.length),
          h('span', { class: 'module-hours' }, icon('clock', 14), `${hours(minutesOf(ids))} h`),
        ),
      ),
      lessonChips(module, `#/practice/${m + 1}`),
    );
  });

  // Paths after Python: open when their Python lessons are ready, or by hand.
  const pathCards = paths().map((path) => {
    const status = pathStatus(path);
    const minutes = minutesOf(path.modules.flatMap((m) => m.lessons.map((l) => l.id)));
    const ready = status.needs.filter((n) => n.ready).length;
    const openAnyway = h(
      'button',
      { type: 'button', class: 'btn btn-plain btn-small' },
      h('span', { class: 'btn-label' }, 'Open it anyway'),
      icon('right', 16),
    );
    openAnyway.addEventListener('click', () => {
      openPath(path.id);
      // Draw the home page again, with the path open.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    return h(
      'section',
      { class: `module path-card${status.open ? ' is-open' : ' is-closed'}` },
      h(
        'div',
        { class: 'module-head' },
        h('span', { class: 'path-icon', 'aria-hidden': 'true' }, status.open ? '>_' : icon('lock', 22)),
        h('div', null, h('h3', null, path.title), h('p', null, path.goal)),
        h('span', { class: 'module-hours' }, icon('clock', 14), `${hours(minutes)} h`),
      ),
      status.open
        ? h(
            'div',
            { class: 'path-modules' },
            ...path.modules.map((module) => h('div', null, h('h4', { class: 'path-module-title' }, module.title), lessonChips(module))),
          )
        : h(
            'div',
            { class: 'path-needs' },
            h('p', null, `Opens when these Python lessons are done and their topics are not weak (${ready} of ${status.needs.length} ready):`),
            h(
              'ul',
              { class: 'module-lessons' },
              ...status.needs.map((n) =>
                h(
                  'li',
                  null,
                  h(
                    'a',
                    { class: `chip is-open${n.ready ? ' is-done' : ''}`, href: `#/lesson/${n.lesson.id}` },
                    icon(n.ready ? 'check' : 'play', 13),
                    h('span', null, n.lesson.title),
                  ),
                ),
              ),
            ),
            h('div', { class: 'path-open' }, openAnyway, h('span', { class: 'muted small' }, 'You decide: the path opens now, and the Python lessons stay where they are.')),
          ),
    );
  });

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
                'a',
                { class: 'btn btn-primary btn-big', href: `#/lesson/${current.id}` },
                h('span', { class: 'btn-label' }, started ? 'Continue' : 'Start the lesson'),
                icon('right', 20),
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

  /** A first visit: what this is, a live example, and the way in. */
  function welcome(): HTMLElement[] {
    return [
      h(
        'section',
        { class: 'hero' },
        h(
          'div',
          { class: 'hero-text' },
          h('h1', { class: 'display display-xl hero-title', 'data-enter': true }, 'Learn Python, then build ', h('em', null, 'without help.')),
          h(
            'p',
            { class: 'lead', 'data-enter': true },
            `Short lessons with code on every screen, checked at once. About ${Math.round(totalMinutes / 60)} hours from your first line to your own desktop app.`,
          ),
          h(
            'div',
            { class: 'hero-actions', 'data-enter': true },
            current
              ? h(
                  'a',
                  { class: 'btn btn-primary btn-big', href: `#/lesson/${current.id}` },
                  h('span', { class: 'btn-label' }, `Start: ${current.title}`),
                  icon('right', 20),
                )
              : null,
            h('a', { class: 'btn btn-big', href: '#course' }, h('span', { class: 'btn-label' }, 'See the course')),
          ),
          h('p', { class: 'muted small', 'data-enter': true }, 'No account needed. Your progress stays on this device.'),
        ),
        h(
          'div',
          { class: 'hero-demo', 'data-enter': true, 'aria-hidden': 'true' },
          h('div', { class: 'hero-card' }, heroCode.el, heroStage),
          h('span', { class: 'hero-note' }, 'Each line of code changes the picture.'),
        ),
      ),
    ];
  }

  /** The modules, the outcomes and the paths. */
  function courseMap(): HTMLElement {
    return h(
      'section',
      { class: 'course-map', id: 'course' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', null, 'The course'),
        h('p', { class: 'muted' }, `${course.modules.length} modules, ${pythonIds.length} lessons. Each module ends with a project.`),
      ),
      h('div', { class: 'modules' }, ...modules),
      h(
        'div',
        { class: 'outcomes-box' },
        h('h3', null, 'At the end you can, alone:'),
        h('ul', { class: 'outcomes' }, ...course.outcomes.map((text) => h('li', null, icon('check', 16), h('span', null, text)))),
        h('a', { class: 'btn btn-small', href: '#/next' }, h('span', { class: 'btn-label' }, 'And after the course?'), icon('right', 16)),
      ),
      pathCards.length
        ? h(
            'div',
            { class: 'paths', id: 'paths' },
            h(
              'div',
              { class: 'section-head' },
              h('h2', null, 'Paths after Python'),
              h('p', { class: 'muted' }, 'The world around Python, in the same kind of lessons. A path opens when the Python it needs is solid.'),
            ),
            h('div', { class: 'modules' }, ...pathCards),
          )
        : h('span'),
    );
  }

  const page = h(
    'div',
    { class: 'home' },
    h('main', { class: 'home-main' }, ...(anyProgress ? today() : welcome()), courseMap()),
    h(
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
    ),
  );

  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  void loop();

  return () => {
    alive = false;
    boxes.dispose();
  };
}
