// The lesson player: one engine for every lesson. It knows step types, never
// lesson content.
import { confetti, gsap, leave, place, stamp } from '@/kit/motion';
import { getSettings, onSettings } from '@/kit/settings';
import { warmPython } from '@/py/runner';
import { course, getLesson, lastCourseLesson, lessonLabel } from './registry';
import { brand, settingsButton } from './settings-menu';
import { describeWait, finishLesson, includeLesson, isSkipped, lessonState, nextDue, reachStep, skipLesson } from './store';
import type { Lesson, Step } from './types';
import { button, h, icon, panel } from './ui';
import type { StepContext, StepView } from './steps/context';
import { renderDemo } from './steps/demo';
import { renderExercise } from './steps/exercise';
import { renderLocal } from './steps/local';
import { renderTerminal } from './steps/terminal';
import { renderDebugger } from './steps/debugger';
import { renderHook } from './steps/hook';
import { renderPredict, renderQuiz, renderReview, renderTheory, renderWorked } from './steps/simple';

const PHASE: Record<Step['type'], string> = {
  hook: 'See it',
  theory: 'Learn',
  predict: 'Predict',
  demo: 'Try',
  worked: 'Example',
  exercise: 'Practice',
  local: 'Your computer',
  terminal: 'Terminal',
  debugger: 'Debug',
  quiz: 'Quiz',
  drill: 'Train',
  investigate: 'Investigate',
  review: 'Review',
};

function renderStep(step: Step, ctx: StepContext): StepView {
  switch (step.type) {
    case 'hook':
      return renderHook(step, ctx);
    case 'theory':
      return renderTheory(step, ctx);
    case 'predict':
      return renderPredict(step, ctx);
    case 'demo':
      return renderDemo(step, ctx);
    case 'worked':
      return renderWorked(step, ctx);
    case 'exercise':
      return renderExercise(step, ctx);
    case 'local':
      return renderLocal(step, ctx);
    case 'terminal':
      return renderTerminal(step, ctx);
    case 'debugger':
      return renderDebugger(step, ctx);
    case 'quiz':
    case 'drill':
    case 'investigate':
      return renderQuiz(step, ctx);
    case 'review':
      return renderReview(step, ctx);
  }
}

/**
 * Skip a lesson the learner does not want. It leaves "continue", review,
 * mistakes and practice, and can be included again at any time.
 */
function skipButton(lessonId: string): HTMLElement {
  const el = h('button', { type: 'button', class: 'icon-btn' }, icon('skip', 20));
  const label = (): void => {
    const text = isSkipped(lessonId) ? 'You skipped this lesson. Include it again' : 'Skip this lesson';
    el.setAttribute('aria-label', text);
    el.title = text;
    el.classList.toggle('is-on', isSkipped(lessonId));
  };
  el.addEventListener('click', () => {
    if (isSkipped(lessonId)) {
      includeLesson(lessonId);
      label();
      return;
    }
    const ok = window.confirm(
      'Skip this lesson?\n\nIt leaves your next steps, your reviews and your practice, and it does not count in "My knowledge". Later lessons may use what it teaches.\n\nYou can include it again at any time, here or on the "My knowledge" page.',
    );
    if (!ok) return;
    skipLesson(lessonId);
    window.location.hash = '#/';
  });
  label();
  return el;
}

export function mountLesson(root: HTMLElement, lessonId: string, startStep?: number): () => void {
  const found = getLesson(lessonId);
  if (!found) {
    root.replaceChildren(
      h('main', { class: 'notfound' }, panel('info', 'This lesson does not exist yet.', h('a', { href: '#/' }, 'Back to the course'))),
    );
    return () => undefined;
  }
  const lesson: Lesson = found;
  const steps = lesson.steps;
  const stats = { first: 0, total: 0, startedAt: Date.now() };
  let index = -1;
  let view: StepView | null = null;
  let finished = false;
  let primaryAction: () => void = () => undefined;
  let graphics = getSettings().graphics;

  // Start Python while the learner watches the hook.
  const idle = window.setTimeout(() => void warmPython().catch(() => undefined), 1500);

  const rail = h('nav', { class: 'rail', 'aria-label': 'Steps of this lesson' });
  const segments = steps.map((step, i) => {
    const seg = h(
      'button',
      { type: 'button', class: 'rail-seg', title: `${PHASE[step.type]}: ${step.title}`, 'aria-label': `Step ${i + 1}: ${step.title}` },
      h('i', null),
    );
    seg.addEventListener('click', () => {
      if (i <= lessonState(lesson.id).reached && i !== index) void go(i);
    });
    rail.append(seg);
    return seg;
  });

  const phase = h('span', { class: 'phase' });
  const stepTitle = h('h1', { class: 'step-title' });
  const objective = h('p', { class: 'objective' });
  const body = h('div', { class: 'step-body' });
  const back = button('Back', { kind: 'ghost', icon: 'left', onClick: () => void go(index - 1) });
  back.classList.add('btn-icon-first');
  const primary = button('Continue', { kind: 'primary', icon: 'right', onClick: () => primaryAction() });
  const note = h('div', { class: 'dock-note', 'aria-live': 'polite' });

  const shell = h(
    'div',
    { class: 'player' },
    h(
      'header',
      { class: 'bar' },
      brand(),
      h('div', { class: 'bar-title' }, h('span', { class: 'bar-kicker' }, lessonLabel(lesson)), h('span', null, lesson.title)),
      rail,
      skipButton(lesson.id),
      settingsButton(),
    ),
    h('main', { class: 'player-main', tabindex: '0' }, h('div', { class: 'step-head' }, phase, stepTitle, objective), body),
    h('footer', { class: 'dock' }, back, note, primary),
  );
  root.replaceChildren(shell);

  function setPrimary(label: string, enabled: boolean, onClick?: () => void): void {
    primary.querySelector('.btn-label')!.textContent = label;
    primary.disabled = !enabled;
    primaryAction = onClick ?? (() => void go(index + 1));
    if (enabled && label !== 'Next' && label !== 'Next line') {
      gsap.fromTo(primary, { scale: 0.94 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)', clearProps: 'transform' });
    }
  }

  function updateRail(): void {
    const reached = lessonState(lesson.id).reached;
    segments.forEach((seg, i) => {
      seg.classList.toggle('is-done', i < index || finished);
      seg.classList.toggle('is-now', i === index && !finished);
      seg.classList.toggle('is-open', i <= reached);
      seg.disabled = i > reached;
      if (i === index) seg.setAttribute('aria-current', 'step');
      else seg.removeAttribute('aria-current');
    });
  }

  async function go(next: number, force = false): Promise<void> {
    if (next < 0 || (next === index && !force)) return;
    if (next >= steps.length) return showDone();
    finished = false;
    if (view) {
      await leave(body);
      view.dispose?.();
    }
    index = next;
    reachStep(lesson.id, index);
    history.replaceState(null, '', `#/lesson/${lesson.id}/${index + 1}`);
    const step = steps[index];
    const showGoal = (id: string): void => {
      const goal = lesson.objectives.find((o) => o.id === id);
      objective.replaceChildren(icon('target', 16), h('span', null, h('b', null, 'Goal: '), goal?.text ?? ''));
    };
    phase.textContent = PHASE[step.type];
    phase.dataset.type = step.type;
    stepTitle.textContent = step.title;
    showGoal(step.objective);
    back.disabled = index === 0;
    note.textContent = '';
    setPrimary('Continue', false);

    const ctx: StepContext = {
      lesson,
      dock: { primary: setPrimary, note: (text) => (note.textContent = text) },
      done: () => setPrimary(index + 1 < steps.length ? 'Continue' : 'Finish lesson', true),
      objective: showGoal,
      grade: (firstTry) => {
        stats.total += 1;
        if (firstTry) stats.first += 1;
      },
    };
    view = renderStep(step, ctx);
    body.replaceChildren(view.el);
    gsap.set(body, { x: 0, opacity: 1 });
    updateRail();
    shell.querySelector('.player-main')!.scrollTo({ top: 0 });
    const entering = view.el.querySelectorAll('[data-enter]');
    place(entering.length ? entering : view.el);
    view.entered?.();
  }

  async function showDone(): Promise<void> {
    if (view) {
      await leave(body);
      view.dispose?.();
      view = null;
    }
    finished = true;
    index = steps.length;
    finishLesson(lesson.id);
    updateRail();
    const minutes = Math.max(1, Math.round((Date.now() - stats.startedAt) / 60000));
    // The last lesson of a module: time for a mixed set of the whole module.
    const moduleAt = course.modules.findIndex((m) => m.lessons.at(-1)?.id === lesson.id);
    const due = nextDue();
    const mark = h('div', { class: 'stamp stamp-hero' }, 'Lesson complete');
    phase.textContent = 'Done';
    phase.dataset.type = 'done';
    stepTitle.textContent = lesson.title;
    objective.replaceChildren();
    const el = h(
      'div',
      { class: 'done' },
      mark,
      h('h1', { class: 'display', 'data-enter': true }, 'You can now do this:'),
      h(
        'ul',
        { class: 'done-list' },
        ...lesson.objectives.map((o) => h('li', { 'data-enter': true }, icon('check', 18), h('span', null, o.text))),
      ),
      h(
        'div',
        { class: 'done-stats', 'data-enter': true },
        h('div', null, h('b', null, `${stats.first} / ${stats.total}`), h('span', null, 'right on the first try')),
        h('div', null, h('b', null, `${minutes} min`), h('span', null, 'time in this lesson')),
        h('div', null, h('b', null, due ? describeWait(due) : 'later'), h('span', null, 'next review')),
      ),
      h(
        'p',
        { class: 'muted', 'data-enter': true },
        'Review is part of the course. Short tests after a pause make memory last longer than reading again.',
      ),
      lesson.extra.length
        ? h(
            'p',
            { class: 'done-practice', 'data-enter': true },
            h('span', null, `Want more practice of this lesson? ${lesson.extra.length} extra exercises are waiting:`),
            h(
              'a',
              { class: 'btn btn-plain', href: `#/practice/lesson/${lesson.id}` },
              h('span', { class: 'btn-label' }, 'Practice more'),
              icon('right', 18),
            ),
          )
        : null,
      moduleAt >= 0
        ? h(
            'p',
            { class: 'done-practice', 'data-enter': true },
            h('span', null, `Module "${course.modules[moduleAt].title}" is done. Mix its lessons in one practice set:`),
            h(
              'a',
              { class: 'btn btn-plain', href: `#/practice/${moduleAt + 1}` },
              h('span', { class: 'btn-label' }, 'Mixed practice'),
              icon('mix', 18),
            ),
          )
        : null,
    );
    body.replaceChildren(el);
    gsap.set(body, { x: 0, opacity: 1 });
    back.disabled = false;
    note.textContent = '';
    // After the last lesson, the next screen is the path after the course.
    const last = lesson.id === lastCourseLesson();
    if (last) setPrimary('What comes next', true, () => (window.location.hash = '#/next'));
    else setPrimary('Back to the course', true, () => (window.location.hash = '#/'));
    place(el.querySelectorAll('[data-enter]'), 0.25);
    stamp(mark).eventCallback('onComplete', () => confetti(mark, 26));
  }

  const stopSettings = onSettings((settings) => {
    // A new graphics choice rebuilds the current screen with the new stage.
    if (settings.graphics === graphics && index >= 0) {
      const type = steps[index]?.type;
      if (type !== 'hook' && type !== 'demo') return;
    }
    graphics = settings.graphics;
    if (index >= 0 && index < steps.length) void go(index, true);
  });

  const reached = lessonState(lesson.id).reached;
  const wanted = startStep !== undefined ? Math.min(startStep - 1, reached, steps.length - 1) : Math.min(reached, steps.length - 1);
  void go(Math.max(0, wanted));

  return () => {
    window.clearTimeout(idle);
    stopSettings();
    view?.dispose?.();
  };
}
