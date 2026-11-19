// Mixed practice: exercises and questions from many lessons, in a mixed
// order. Inside a lesson every task is about the topic of that lesson, so
// the learner never has to choose the tool. Here they must. Mixing
// (interleaving) and spacing make memory last longer (see
// docs/analysis-2026-11.md).
import { place } from '@/kit/motion';
import { warmPython } from '@/py/runner';
import { pageBar } from './playground';
import { course, getLesson, itemsOf } from './registry';
import type { StepContext, StepView } from './steps/context';
import { renderExercise } from './steps/exercise';
import { renderItem } from './steps/item';
import { lastPracticed, lessonState, noteAnswer, notePracticed } from './store';
import type { ExerciseStep, Item, Lesson } from './types';
import { button, h, icon, panel, shuffle } from './ui';

type Task = { lesson: Lesson; ref: string } & ({ kind: 'exercise'; step: ExerciseStep } | { kind: 'item'; item: Item });

/** Exercises and questions in a set. Exercises take longer, so fewer of them. */
const SET = { exercises: 4, items: 3 };
/** Kinds of questions that make you work with code (not only recall a fact). */
const CODE_ITEMS = new Set<Item['kind']>(['trace', 'predict', 'order', 'diagnose', 'spot']);

/** Every task of a lesson that makes sense on its own, outside the lesson. */
function tasksOf(lesson: Lesson): Task[] {
  const tasks: Task[] = [];
  for (const step of lesson.steps) {
    // Project steps build on the step before, so they need the lesson.
    if (step.type === 'exercise' && step.fade !== 'milestone' && !step.carry) {
      tasks.push({ kind: 'exercise', lesson, step, ref: `step:${step.id}` });
    }
    for (const item of itemsOf(step)) {
      if (CODE_ITEMS.has(item.kind)) tasks.push({ kind: 'item', lesson, item, ref: item.id });
    }
  }
  return tasks;
}

/** The tasks practiced longest ago first; never practiced counts as oldest. */
function oldestFirst(tasks: Task[], count: number): Task[] {
  return shuffle(tasks)
    .sort((a, b) => lastPracticed(a.lesson.id, a.ref) - lastPracticed(b.lesson.id, b.ref))
    .slice(0, count);
}

/** A mixed order: two tasks of one lesson are never next to each other, if it can be helped. */
function interleave(tasks: Task[]): Task[] {
  const left = shuffle(tasks);
  const out: Task[] = [];
  while (left.length) {
    const prev = out.at(-1);
    let at = left.findIndex((t) => t.lesson.id !== prev?.lesson.id && t.kind !== prev?.kind);
    if (at === -1) at = left.findIndex((t) => t.lesson.id !== prev?.lesson.id);
    if (at === -1) at = 0;
    out.push(...left.splice(at, 1));
  }
  return out;
}

function finishedLessons(module?: number): Lesson[] {
  const entries = module === undefined ? course.modules.flatMap((m) => m.lessons) : course.modules[module].lessons;
  return entries.map((e) => getLesson(e.id)).filter((l): l is Lesson => Boolean(l && lessonState(l.id).done));
}

/**
 * A set of tasks. For a module: mostly its own lessons, plus one or two
 * tasks from earlier modules, so old topics come back too.
 */
function pickSet(module?: number): Task[] {
  const own = finishedLessons(module).flatMap(tasksOf);
  const earlier =
    module === undefined ? [] : course.modules.slice(0, module).flatMap((_, m) => finishedLessons(m)).flatMap(tasksOf);
  const pick = (kind: Task['kind'], count: number): Task[] => {
    const fromEarlier = Math.min(module === undefined ? 0 : 1, earlier.filter((t) => t.kind === kind).length);
    const mine = oldestFirst(own.filter((t) => t.kind === kind), count - fromEarlier);
    const old = oldestFirst(earlier.filter((t) => t.kind === kind), count - mine.length);
    return [...mine, ...old];
  };
  return interleave([...pick('exercise', SET.exercises), ...pick('item', SET.items)]);
}

/** `which`: nothing for the overview, "all" for a set of all lessons, or a module number (1 is the first). */
export function mountPractice(root: HTMLElement, which?: string): () => void {
  let view: StepView | null = null;
  let primaryAction: () => void = () => undefined;
  const body = h('div', { class: 'step-body' });
  const note = h('div', { class: 'dock-note', 'aria-live': 'polite' });
  const primary = button('Next task', { kind: 'primary', icon: 'right', onClick: () => primaryAction() });
  primary.hidden = true;
  const back = h('a', { class: 'btn btn-ghost', href: '#/practice' }, h('span', { class: 'btn-label' }, 'All practice'));
  const main = h('main', { class: 'player-main', tabindex: '0' }, body);
  root.replaceChildren(
    h('div', { class: 'player' }, pageBar('Mixed practice', 'Tasks from many lessons'), main, h('footer', { class: 'dock' }, back, note, primary)),
  );
  const number = Number(which);
  const module = Number.isInteger(number) && course.modules[number - 1] ? number - 1 : undefined;

  function show(el: HTMLElement): void {
    view?.dispose?.();
    view = null;
    body.replaceChildren(el);
    main.scrollTo({ top: 0 });
    place(el.querySelectorAll('[data-enter]').length ? el.querySelectorAll('[data-enter]') : el);
  }

  function overview(): void {
    primary.hidden = true;
    back.hidden = true;
    note.textContent = '';
    const any = finishedLessons().length > 0;
    const rows = course.modules.map((m, i) => {
      const done = finishedLessons(i).length;
      const all = m.lessons.length;
      const start = h(
        'a',
        { class: `btn btn-plain btn-small${done ? '' : ' is-disabled'}`, href: `#/practice/${i + 1}`, 'aria-disabled': done ? null : 'true' },
        h('span', { class: 'btn-label' }, 'Practice'),
        icon('right', 16),
      );
      if (!done) start.addEventListener('click', (event) => event.preventDefault());
      return h(
        'li',
        { class: 'practice-row' },
        h('span', { class: 'module-num' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'practice-name' }, h('strong', null, m.title), h('small', null, `${done} of ${all} lessons done`)),
        start,
      );
    });
    show(
      h(
        'div',
        { class: 'single practice' },
        h('h1', { class: 'display', 'data-enter': true }, 'Mixed practice'),
        h(
          'p',
          { class: 'lead', 'data-enter': true },
          'Exercises and questions from your finished lessons, in a mixed order. In a lesson you know the topic of each task. In a real program you must choose the right tool yourself: mixed practice trains exactly that.',
        ),
        h('p', { class: 'muted', 'data-enter': true }, 'It feels harder than practice of one topic. That is normal, and it is why memory lasts longer. The tasks you practiced longest ago come first.'),
        any
          ? h(
              'div',
              { class: 'practice-start', 'data-enter': true },
              h('a', { class: 'btn btn-primary btn-big', href: '#/practice/all' }, h('span', { class: 'btn-label' }, 'Start a mixed set'), icon('mix', 20)),
              h('span', { class: 'muted' }, `About ${SET.exercises} exercises and ${SET.items} questions, from all your finished lessons.`),
            )
          : h('div', { 'data-enter': true }, panel('info', 'Finish a lesson first.', 'Mixed practice uses the tasks of the lessons you finished.')),
        h('h2', { class: 'sheet-title', 'data-enter': true }, 'By module'),
        h('p', { class: 'muted', 'data-enter': true }, 'Best at the end of a module: mostly its own lessons, and a little from the modules before.'),
        h('ol', { class: 'practice-list', 'data-enter': true }, ...rows),
      ),
    );
  }

  function run(tasks: Task[]): void {
    back.hidden = false;
    primary.hidden = false;
    let first = 0;
    void warmPython().catch(() => undefined);

    const step = (index: number): void => {
      if (index >= tasks.length) return summary(first, tasks.length);
      const task = tasks[index];
      const count = h(
        'div',
        { class: 'sequence-count practice-count', 'data-enter': true },
        ...tasks.map((_, i) => h('i', { class: i < index ? 'is-done' : i === index ? 'is-now' : '' })),
        h('span', null, `Task ${index + 1} of ${tasks.length}`),
        h('span', { class: 'practice-from' }, `From lesson ${task.lesson.order}: ${task.lesson.title}`),
      );
      const next = (): void => step(index + 1);
      const label = index + 1 < tasks.length ? 'Next task' : 'Finish';
      const setPrimary = (text: string, enabled: boolean, onClick?: () => void): void => {
        primary.querySelector('.btn-label')!.textContent = text === 'Continue' || text === 'Finish lesson' ? label : text;
        primary.disabled = !enabled;
        primaryAction = onClick ?? next;
      };
      const ctx: StepContext = {
        lesson: task.lesson,
        dock: { primary: setPrimary, note: (text) => (note.textContent = text) },
        done: () => {
          notePracticed(task.lesson.id, task.ref);
          setPrimary(label, true);
        },
        objective: () => undefined,
        grade: (firstTry) => {
          if (firstTry) first += 1;
        },
      };
      setPrimary(label, false);
      note.textContent = '';
      let el: HTMLElement;
      if (task.kind === 'exercise') {
        const exercise = renderExercise(task.step, ctx);
        el = h('div', null, count, h('h2', { class: 'practice-title', 'data-enter': true }, task.step.title), exercise.el);
        show(el);
        view = exercise;
      } else {
        const item = renderItem(task.item, (firstTry) => {
          ctx.grade(firstTry);
          noteAnswer(task.lesson.id, task.ref, !firstTry);
          ctx.done();
        });
        el = h('div', { class: 'single' }, count, h('div', { 'data-enter': true }, item.el));
        show(el);
        view = { el, dispose: item.dispose };
      }
      view.entered?.();
    };
    step(0);
  }

  function summary(first: number, total: number): void {
    primary.querySelector('.btn-label')!.textContent = 'Another set';
    primary.disabled = false;
    primaryAction = () => run(pickSet(module));
    note.textContent = '';
    show(
      h(
        'div',
        { class: 'single practice' },
        h('h1', { class: 'display', 'data-enter': true }, 'Set done'),
        h(
          'div',
          { class: 'done-stats', 'data-enter': true },
          h('div', null, h('b', null, `${first} / ${total}`), h('span', null, 'right on the first try')),
        ),
        h(
          'p',
          { class: 'muted', 'data-enter': true },
          first === total
            ? 'All right on the first try. Next time, the set takes other tasks.'
            : 'The tasks that were hard are on your "My mistakes" list now. Practice them there, or do another mixed set.',
        ),
        h('a', { class: 'btn btn-plain', href: '#/', 'data-enter': true }, h('span', { class: 'btn-label' }, 'Back to the course')),
      ),
    );
  }

  if (which === undefined || (which !== 'all' && module === undefined)) overview();
  else {
    const tasks = pickSet(module);
    if (tasks.length === 0) overview();
    else run(tasks);
  }
  return () => view?.dispose?.();
}
