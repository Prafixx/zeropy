// Home: what the course is, how a lesson works, the curriculum map.
import { Boxes2D } from '@/kit/actors/variable-boxes-2d';
import type { BoxVar } from '@/kit/actors/variable-boxes';
import { finished, isReduced, place, revealLines, revealOnScroll, sleep } from '@/kit/motion';
import { course, getLesson, lessons } from './registry';
import { brand, settingsButton } from './settings-menu';
import { dueCards, isSkipped, lessonState, mistakes } from './store';
import { codeBlock, h, icon } from './ui';

const LOOP = [
  { name: 'See it', why: 'An animation shows the idea before any text.' },
  { name: 'Learn', why: 'Only the theory you need for the next task.' },
  { name: 'Predict', why: 'You guess the output first. Guessing makes memory stronger.' },
  { name: 'Try', why: 'You change real code and watch each line run.' },
  { name: 'Practice', why: 'Exercises with instant checks and clear feedback.' },
  { name: 'Review', why: 'Old questions come back just before you forget.' },
];

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
  const current = available.find((l) => !lessonState(l.id).done && !isSkipped(l.id)) ?? available[0];
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

  const modules = course.modules.map((module, m) =>
    h(
      'section',
      { class: 'module', 'data-reveal': true },
      h(
        'div',
        { class: 'module-head' },
        h('span', { class: 'module-num' }, String(m + 1).padStart(2, '0')),
        h('div', null, h('h3', null, module.title), h('p', null, module.goal)),
        h('span', { class: 'module-hours' }, icon('clock', 14), `${hours(minutesOf(module.lessons.map((l) => l.id)))} h`),
      ),
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
        module.lessons.some((entry) => lessonState(entry.id).done)
          ? h(
              'li',
              null,
              h('a', { class: 'chip is-open is-practice', href: `#/practice/${m + 1}` }, icon('mix', 13), h('span', null, 'Mixed practice')),
            )
          : null,
      ),
    ),
  );

  const page = h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'bar bar-home' },
      brand(),
      h('div', { class: 'bar-spacer' }),
      h(
        'nav',
        { class: 'bar-nav', 'aria-label': 'Tools' },
        h('a', { class: 'bar-link', href: '#/knowledge', 'aria-label': 'My knowledge' }, icon('bars', 18), h('span', null, 'Knowledge')),
        h('a', { class: 'bar-link', href: '#/practice', 'aria-label': 'Mixed practice' }, icon('mix', 18), h('span', null, 'Practice')),
        h('a', { class: 'bar-link', href: '#/playground', 'aria-label': 'Playground' }, icon('code', 18), h('span', null, 'Playground')),
        h('a', { class: 'bar-link', href: '#/cheatsheet', 'aria-label': 'Cheat sheet' }, icon('book', 18), h('span', null, 'Cheat sheet')),
      ),
      settingsButton(),
    ),
    h(
      'main',
      null,
      h(
        'section',
        { class: 'hero' },
        h(
          'div',
          { class: 'hero-text' },
          h('p', { class: 'kicker', 'data-enter': true }, 'Python course · from zero · free'),
          h('h1', { class: 'display display-xl hero-title' }, 'Learn Python.', h('br', null), 'Then build ', h('em', null, 'without help.')),
          h(
            'p',
            { class: 'lead', 'data-enter': true },
            `Short lessons. You write code on every screen. About ${Math.round(totalMinutes / 60)} hours from your first line to your own desktop app.`,
          ),
          h(
            'div',
            { class: 'hero-actions', 'data-enter': true },
            current
              ? h(
                  'a',
                  { class: 'btn btn-primary btn-big', href: `#/lesson/${current.id}` },
                  h('span', { class: 'btn-label' }, `${started ? 'Continue' : 'Start'}: ${current.title}`),
                  icon('right', 20),
                )
              : null,
            due > 0
              ? h('a', { class: 'btn btn-plain btn-big', href: '#/review' }, h('span', { class: 'btn-label' }, `Review ${due} card${due === 1 ? '' : 's'}`), icon('loop', 18))
              : null,
            missed > 0
              ? h('a', { class: 'btn btn-plain btn-big', href: '#/mistakes' }, h('span', { class: 'btn-label' }, `My mistakes (${missed})`), icon('target', 18))
              : null,
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
      h(
        'section',
        { class: 'band' },
        h('h2', { class: 'display', 'data-reveal': true }, 'Every lesson uses the same loop'),
        h('p', { class: 'lead', 'data-reveal': true }, 'About 70% of your time is practice. That is how skills are built.'),
        h(
          'ol',
          { class: 'loop' },
          ...LOOP.map((item, i) =>
            h('li', { class: 'loop-card', 'data-reveal': true }, h('span', { class: 'loop-num' }, String(i + 1)), h('h3', null, item.name), h('p', null, item.why)),
          ),
        ),
      ),
      h(
        'section',
        { class: 'band band-ink' },
        h('h2', { class: 'display', 'data-reveal': true }, 'At the end you can, alone:'),
        h('ul', { class: 'outcomes' }, ...course.outcomes.map((text) => h('li', { 'data-reveal': true }, icon('check', 18), h('span', null, text)))),
        h(
          'a',
          { class: 'btn btn-primary next-link', href: '#/next', 'data-reveal': true },
          h('span', { class: 'btn-label' }, 'And after the course? See the path'),
          icon('right', 18),
        ),
      ),
      h(
        'section',
        { class: 'band', id: 'course' },
        h('h2', { class: 'display', 'data-reveal': true }, 'The course'),
        h('p', { class: 'lead', 'data-reveal': true }, 'Eight modules. Each one ends with a project that uses everything before it.'),
        h('div', { class: 'modules' }, ...modules),
      ),
    ),
    h(
      'footer',
      { class: 'foot' },
      brand(),
      h(
        'span',
        null,
        'Made by Prafix, with AI assistance. Free to use. ',
        h('a', { href: 'THIRD-PARTY-NOTICES.txt', target: '_blank', rel: 'noopener' }, 'Licenses'),
      ),
    ),
  );

  root.replaceChildren(page);
  window.scrollTo({ top: 0 });
  place(page.querySelectorAll('[data-enter]'));
  const stopReveal = revealOnScroll(page);
  // Split after the fonts are ready, or the line breaks would be wrong.
  let stopTitle: () => void = () => undefined;
  const title = page.querySelector<HTMLElement>('.hero-title')!;
  void document.fonts.ready.then(() => {
    if (alive) stopTitle = revealLines(title);
  });
  void loop();

  return () => {
    alive = false;
    stopReveal();
    stopTitle();
    boxes.dispose();
  };
}
