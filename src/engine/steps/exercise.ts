// Exercise: write code, get instant validation. Checks test behavior on
// several cases; feedback names the failed requirement and why.
import { confetti, place, shake, stamp } from '@/kit/motion';
import { runPython, warmPython } from '@/py/runner';
import { loadCode, noteAnswer, saveCode } from '../store';
import type { ExerciseStep } from '../types';
import { button, codeBlock, h, icon, md, mdInline, panel } from '../ui';
import type { StepContext, StepView } from './context';
import { createBoard } from './board';
import { createWorkbench } from './workbench';

const FADE_LABEL: Record<ExerciseStep['fade'], string> = {
  completion: 'Complete the code',
  debug: 'Find and fix the bug',
  independent: 'Write it yourself',
  milestone: 'Project step',
  challenge: 'Challenge',
};

/** A challenge shows only how many checks pass, until this many failed runs. */
const CHALLENGE_REVEAL = 3;

export function renderExercise(step: ExerciseStep, ctx: StepContext): StepView {
  void warmPython().catch(() => undefined);
  let attempts = 0;
  let hintsShown = 0;
  let solved = false;
  // The solution was shown before the code passed.
  let helped = false;
  let disposed = false;

  // A challenge: a spec only. The checks and hints stay hidden until the
  // learner is stuck (CHALLENGE_REVEAL failed runs); a run only says how
  // many checks pass, so the learner must think of the edge cases.
  const challenge = step.fade === 'challenge';
  let revealed = !challenge;
  const cases = (step.cases ?? [{}]).map((c) => ({ ...c, setup: c.setup ?? step.given, files: c.files ?? step.files, web: c.web ?? step.web }));
  const checkRows = step.checks.map((check) =>
    h('li', { class: 'check' }, h('span', { class: 'check-mark' }), h('span', null, mdInline(check.pass))),
  );
  const feedback = h('div', { class: 'exercise-feedback', 'aria-live': 'polite' });
  const hintList = h('ol', { class: 'hints' });
  const hintButton = button(`Show a hint (1 of ${step.hints.length})`, { kind: 'ghost', small: true, icon: 'bulb', onClick: showHint });
  hintButton.hidden = !revealed;
  const checksList = h('ul', { class: 'checks' }, ...checkRows);
  checksList.hidden = !revealed;
  const checksTitle = h('h2', { class: 'todo-title' }, revealed ? 'Your code is correct when' : `${step.checks.length} hidden checks`);
  const checkSummary = h(
    'p',
    { class: 'challenge-note', hidden: revealed },
    'The checks are hidden: a run tells you how many pass. Test your code with your own values first, also the borders and the odd cases.',
  );
  const solutionButton = button('Show a solution', { kind: 'ghost', small: true, onClick: showSolution });
  solutionButton.hidden = true;
  const solutionSlot = h('div', { class: 'solution-slot' });
  // A project step starts with the learner's own code: the last version of
  // this step, or the code that passed the step before.
  const lessonId = ctx.lesson.id;
  const own = step.carry
    ? (loadCode(lessonId, step.id) ?? (step.prev ? loadCode(lessonId, `${step.prev}:ok`) : undefined))
    : undefined;
  const baseButton = button('Load a working version of the last step', {
    kind: 'ghost',
    small: true,
    onClick: () => {
      if (step.base && window.confirm('Replace your code with a working version of the last step?')) bench.setCode(step.base);
    },
  });
  baseButton.hidden = !step.base;
  const bench = createWorkbench({ code: own ?? step.starter, onRun, tall: step.carry, files: step.files });
  // A Raspberry Pi program: the board plays the run. An input on it runs the
  // code again from that moment (it is not one more attempt).
  const board = step.board
    ? createBoard({ onInput: (_, at) => void onRun(bench.getCode(), at), onOutput: (text) => bench.setOutput(text) })
    : null;

  const el = h(
    'div',
    { class: 'split split-wide' },
    h(
      'div',
      { class: 'split-text', 'data-enter': true },
      h('span', { class: `tag tag-${step.fade}` }, FADE_LABEL[step.fade]),
      md(step.prompt),
      step.given
        ? h('div', { class: 'given' }, h('div', { class: 'given-label' }, 'This code runs before your code:'), codeBlock(step.given).el)
        : null,
      checksTitle,
      checkSummary,
      checksList,
      feedback,
      hintList,
      h('div', { class: 'exercise-help' }, hintButton, solutionButton, baseButton),
      solutionSlot,
    ),
    h('div', { class: 'split-visual', 'data-enter': true }, board?.el ?? null, bench.el),
  );

  function showHint(): void {
    if (hintsShown >= step.hints.length) return;
    const item = h('li', null, mdInline(step.hints[hintsShown]));
    hintList.append(item);
    place(item);
    hintsShown += 1;
    if (hintsShown >= step.hints.length) hintButton.hidden = true;
    else hintButton.querySelector('.btn-label')!.textContent = `Show a hint (${hintsShown + 1} of ${step.hints.length})`;
  }

  function showSolution(): void {
    if (!solved) helped = true;
    solutionButton.hidden = true;
    solutionSlot.replaceChildren(
      h('div', { class: 'given-label' }, solved ? 'One possible solution:' : 'One possible solution. Type it yourself, then run it:'),
      codeBlock(step.solution).el,
    );
    place(solutionSlot);
  }

  /** Show the checks and the hints: the learner is stuck on a challenge. */
  function reveal(): void {
    if (revealed) return;
    revealed = true;
    checksTitle.textContent = 'Your code is correct when';
    checkSummary.hidden = true;
    checksList.hidden = false;
    hintButton.hidden = hintsShown >= step.hints.length;
    place(checksList);
  }

  function setChecks(states: (boolean | null)[]): void {
    checkRows.forEach((row, i) => {
      const state = states[i];
      row.classList.toggle('is-pass', state === true);
      row.classList.toggle('is-fail', state === false);
      const mark = row.querySelector('.check-mark')!;
      mark.replaceChildren(state === null ? '' : icon(state ? 'check' : 'cross', 14));
    });
  }

  async function onRun(code: string, from?: number): Promise<void> {
    if (board && from === undefined) board.reset();
    if (step.carry) saveCode(lessonId, step.id, code);
    // Case 1 is the code as written: it gets the answers the learner types.
    const done = await bench.interact((stdin, seed) =>
      runPython({
        code,
        cases: cases.map((c, i) =>
          i === 0 ? { ...c, stdin, seed, gpio: board ? { ...c.gpio, events: [...(c.gpio?.events ?? []), ...board.inputs()] } : c.gpio } : c,
        ),
        pytest: step.pytest,
        checks: step.checks.map((c) => ({ expr: c.expr, misconceptions: c.misconceptions })),
      }),
    );
    if (!done || disposed) return;
    const { result } = done;
    if (from === undefined) attempts += 1;
    if (board) board.play(result.gpio, result.stdout, from);
    else bench.setOutput(result.stdout);
    bench.setFiles(result.files);
    bench.setWindow(result.gui);
    bench.setCharts(result.plot);
    bench.setServer(result.server);
    bench.showError(result.error);
    bench.markLine(result.error?.line ?? null, 'error');
    setChecks(result.checks.map((c) => c.pass));

    const failedIndex = result.checks.findIndex((c) => !c.pass);
    if (failedIndex === -1) {
      if (step.carry) saveCode(lessonId, `${step.id}:ok`, code);
      if (!solved) {
        solved = true;
        ctx.grade(attempts === 1);
        // Hard work goes on the "My mistakes" list; an easy pass takes it off.
        noteAnswer(lessonId, `${step.isExtra ? 'extra' : 'step'}:${step.id}`, helped || attempts > 2);
        ctx.done();
      }
      const mark = h('span', { class: 'stamp stamp-big' }, 'Correct');
      feedback.replaceChildren(
        panel('good', 'All checks pass.', step.after ? md(step.after, 'prose prose-small') : null),
      );
      bench.frame.append(mark);
      stamp(mark);
      confetti(mark, 18);
      window.setTimeout(() => mark.remove(), 2200);
      hintButton.hidden = true;
      solutionButton.hidden = false;
      solutionButton.querySelector('.btn-label')!.textContent = 'Compare with a model solution';
      place(feedback.children);
      return;
    }

    const failed = result.checks[failedIndex];
    const check = step.checks[failedIndex];
    shake(bench.frame);
    if (!revealed && attempts >= CHALLENGE_REVEAL) reveal();
    if (!revealed) {
      const passing = result.checks.filter((c) => c.pass).length;
      feedback.replaceChildren(
        panel(
          'bad',
          result.error ? 'Python stopped with an error.' : `${passing} of ${result.checks.length} checks pass.`,
          h(
            'p',
            null,
            result.error
              ? 'Read the message under the editor, fix that line, and run again.'
              : `Not yet. Which input could break your code? After ${CHALLENGE_REVEAL - attempts} more ${CHALLENGE_REVEAL - attempts === 1 ? 'run' : 'runs'}, the checks and hints open.`,
          ),
        ),
      );
      place(feedback.children);
      return;
    }
    if (result.error) {
      // A targeted note for this kind of error, if the lesson has one.
      // Otherwise the general advice: read the message.
      feedback.replaceChildren(
        panel(
          'bad',
          'Python stopped with an error.',
          h('p', null, failed.note ? mdInline(failed.note) : 'Read the message under the editor. Fix that line, then run again.'),
        ),
      );
    } else {
      feedback.replaceChildren(
        panel(
          'bad',
          failed.case ? 'It works for your values, but not in general.' : 'Not yet.',
          failed.case ? h('p', null, mdInline(`The check failed when ${failed.case}.`)) : null,
          h('p', null, mdInline(failed.note ?? check.hint)),
        ),
      );
    }
    place(feedback.children);
    if (attempts >= (challenge ? 2 * CHALLENGE_REVEAL : 3) && !solved) solutionButton.hidden = false;
  }

  ctx.dock.primary('Continue', false);
  ctx.dock.note('Run your code to check it. Ctrl + Enter also runs.');
  return {
    el,
    dispose() {
      disposed = true;
      bench.dispose();
      board?.dispose();
    },
  };
}
