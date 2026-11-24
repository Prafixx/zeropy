// Debugger: a small copy of the debugger of VS Code over the real run of
// the code. The learner sets breakpoints by clicking line numbers, and moves
// with Continue, Step over, Step into and Step out (the same keys as VS
// Code). The panels show the variables of the current call, the call stack
// and the output so far. Tasks ask for values at a stop, or for a stop
// inside a call; they are checked against the same trace.
import { place, shake } from '@/kit/motion';
import { runPython, warmPython } from '@/py/runner';
import { nextPause, pauseAt, pausesOf, sameValue, valueAt } from '../debug-session';
import type { Move, Pause } from '../debug-session';
import { noteEvidence } from '../store';
import type { DebuggerStep, DebugTask, RunResult, VarState } from '../types';
import { button, codeBlock, h, icon, md, mdInline, panel } from '../ui';
import type { StepContext, StepView } from './context';

const MOVES: { move: Move; label: string; key: string; title: string }[] = [
  { move: 'continue', label: 'Continue', key: 'F5', title: 'Run to the next breakpoint (F5)' },
  { move: 'over', label: 'Step over', key: 'F10', title: 'Run this line, also a whole call, and stop on the next line (F10)' },
  { move: 'into', label: 'Step into', key: 'F11', title: 'Go into the call on this line (F11)' },
  { move: 'out', label: 'Step out', key: '⇧F11', title: 'Run to the end of this call, and stop where it was called (Shift+F11)' },
];

export function renderDebugger(step: DebuggerStep, ctx: StepContext): StepView {
  void warmPython().catch(() => undefined);
  let result: RunResult | null = null;
  let pauses: Pause[] = [];
  let current = -1;
  let ended = false;
  let wrong = 0;
  let solved = false;
  let disposed = false;
  let hintsShown = 0;
  const breakpoints = new Set<number>(step.breakpoints ?? []);
  const done = new Set<number>();

  // ---- the debugger panel --------------------------------------------------
  const code = codeBlock(step.code, { numbers: true });
  code.el.classList.add('dbg-code');
  code.lines.forEach((row, i) => {
    const num = row.querySelector<HTMLElement>('.code-num')!;
    num.removeAttribute('aria-hidden');
    num.setAttribute('role', 'button');
    num.setAttribute('tabindex', '0');
    num.title = 'Set or remove a breakpoint';
    num.setAttribute('aria-label', `Breakpoint on line ${i + 1}`);
    const toggle = () => {
      if (breakpoints.has(i + 1)) breakpoints.delete(i + 1);
      else breakpoints.add(i + 1);
      paintBreakpoints();
    };
    num.addEventListener('click', toggle);
    num.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
  const moveButtons = MOVES.map((m) =>
    button(`${m.label} ${m.key}`, { kind: m.move === 'continue' ? 'primary' : 'ghost', small: true, onClick: () => go(m.move) }),
  );
  MOVES.forEach((m, i) => (moveButtons[i].title = m.title));
  const restart = button('Restart', { kind: 'ghost', small: true, icon: 'loop', onClick: () => reset() });
  const status = h('p', { class: 'dbg-status', 'aria-live': 'polite' }, 'Starting Python…');
  const variables = h('div', { class: 'dbg-list' });
  const stack = h('ol', { class: 'dbg-stack' });
  const output = h('pre', { class: 'dbg-out' });
  const box = h(
    'div',
    { class: 'dbg' },
    h('div', { class: 'dbg-bar' }, ...moveButtons, restart),
    status,
    code.el,
    h(
      'div',
      { class: 'dbg-panels' },
      h('section', { class: 'dbg-panel' }, h('h4', null, 'Variables'), variables),
      h('section', { class: 'dbg-panel' }, h('h4', null, 'Call stack'), stack),
    ),
    h('section', { class: 'dbg-panel' }, h('h4', null, 'Output'), output),
  );

  // ---- the tasks -----------------------------------------------------------
  const feedback = h('div', { class: 'exercise-feedback', 'aria-live': 'polite' });
  const inputs = new Map<number, HTMLInputElement>();
  const taskRows = step.tasks.map((task, i) => {
    const text = h('span', null, mdInline(task.do));
    const row = h('li', { class: 'check' }, h('span', { class: 'check-mark' }), text);
    if (task.name !== undefined) {
      const input = h('input', { class: 'dbg-answer', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': `Value of ${task.name}` });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') checkAnswers();
      });
      inputs.set(i, input);
      text.append(input);
    }
    return row;
  });
  const checkButton = button('Check my answers', { kind: 'primary', small: true, icon: 'check', onClick: () => checkAnswers() });
  checkButton.hidden = inputs.size === 0;
  const hintList = h('ol', { class: 'hints' });
  const hintButton = button(`Show a hint (1 of ${step.hints.length})`, { kind: 'ghost', small: true, icon: 'bulb', onClick: showHint });

  const el = h(
    'div',
    { class: 'split split-wide' },
    h(
      'div',
      { class: 'split-text', 'data-enter': true },
      h('span', { class: 'tag tag-debug' }, 'Debugger'),
      md(step.prompt),
      h('h2', { class: 'todo-title' }, 'Your tasks'),
      h('ul', { class: 'checks' }, ...taskRows),
      checkButton,
      feedback,
      hintList,
      h('div', { class: 'exercise-help' }, hintButton),
    ),
    h('div', { class: 'split-visual', 'data-enter': true }, box),
  );

  // ---- state ---------------------------------------------------------------
  function paintBreakpoints(): void {
    code.lines.forEach((row, i) => row.classList.toggle('is-break', breakpoints.has(i + 1)));
  }

  function varRows(vars: VarState[], empty = 'No names yet.'): HTMLElement[] {
    if (vars.length === 0) return [h('p', { class: 'dbg-empty' }, empty)];
    return vars.map((v) => h('div', { class: 'dbg-var' }, h('span', { class: 'dbg-name' }, v.name), h('span', { class: 'dbg-value' }, v.repr)));
  }

  function show(): void {
    const pause = !ended && current >= 0 ? pauses[current] : null;
    code.setActive(pause ? pause.line : null);
    code.lines.forEach((row) => row.classList.remove('is-error'));
    if (!result) return;
    if (pause) {
      const frame = pause.frames.at(-1);
      variables.replaceChildren(
        ...(frame ? [h('h5', null, `Locals: ${frame.name}()`), ...varRows(frame.vars)] : []),
        h('h5', null, 'Globals'),
        ...varRows(pause.globals, 'No variables yet. (Functions are not shown.)'),
      );
      stack.replaceChildren(
        ...[...pause.frames].reverse().map((f, i) => h('li', { class: i === 0 ? 'is-current' : '' }, `${f.name}()`)),
        h('li', { class: pause.frames.length === 0 ? 'is-current' : '' }, '<module>'),
      );
      output.textContent = result.stdout.slice(0, pause.out);
      status.textContent = `Stopped on line ${pause.line}${pause.frames.length ? `, in ${pause.frames.at(-1)!.name}()` : ''}. Line ${pause.line} has not run yet.`;
    } else if (ended) {
      const finalVars = result.vars;
      variables.replaceChildren(h('h5', null, 'Globals'), ...varRows(finalVars));
      stack.replaceChildren();
      output.textContent = result.stdout;
      if (result.error) {
        status.textContent = `The program stopped with ${result.error.type} on line ${result.error.line ?? '?'}.`;
        if (result.error.line) code.lines[result.error.line - 1]?.classList.add('is-error');
      } else {
        status.textContent = 'The program ended. Press Restart to run it again.';
      }
    } else {
      variables.replaceChildren(h('p', { class: 'dbg-empty' }, 'The program has not started.'));
      stack.replaceChildren();
      output.textContent = '';
      status.textContent = breakpoints.size
        ? 'Ready. Press Continue to run to the first breakpoint, or Step over to stop on the first line.'
        : 'Ready. Click a line number to set a breakpoint, then press Continue. Or press Step over to start on the first line.';
    }
    moveButtons.forEach((b) => (b.disabled = ended));
  }

  function go(move: Move): void {
    if (!result || ended) return;
    const next = nextPause(pauses, current, move, breakpoints);
    if (next >= pauses.length) {
      ended = true;
      current = -1;
    } else current = next;
    show();
    reached();
  }

  function reset(): void {
    current = -1;
    ended = false;
    show();
  }

  /** Tasks without an answer: the learner only has to stop in the right place. */
  function reached(): void {
    if (ended || current < 0) return;
    const pause = pauses[current];
    step.tasks.forEach((task, i) => {
      if (task.name !== undefined || done.has(i)) return;
      const hit = task.frame !== undefined ? pause.frames.at(-1)?.name === task.frame : pause === pauseAt(pauses, task.line!, task.hit ?? 1);
      if (hit) mark(i, true);
    });
    finishIfDone();
  }

  function mark(i: number, ok: boolean | null): void {
    if (ok) done.add(i);
    const row = taskRows[i];
    row.classList.toggle('is-pass', ok === true);
    row.classList.toggle('is-fail', ok === false);
    row.querySelector('.check-mark')!.replaceChildren(ok === null ? '' : icon(ok ? 'check' : 'cross', 14));
  }

  function expected(task: DebugTask): string | undefined {
    const pause = pauseAt(pauses, task.line!, task.hit ?? 1);
    return pause ? valueAt(pause, task.name!) : undefined;
  }

  function checkAnswers(): void {
    if (!result) return;
    let note: string | null = null;
    for (const [i, input] of inputs) {
      if (done.has(i)) continue;
      const task = step.tasks[i];
      const answer = input.value;
      if (!answer.trim()) {
        mark(i, null);
        continue;
      }
      const value = expected(task);
      const ok = value !== undefined && sameValue(answer, value);
      mark(i, ok);
      if (ok) {
        input.disabled = true;
        continue;
      }
      wrong += 1;
      // The value of another stop on the same line: the count is off.
      const other = pauses.filter((p) => p.line === task.line).some((p) => {
        const v = valueAt(p, task.name!);
        return v !== undefined && sameValue(answer, v);
      });
      note ??= other
        ? `That is \`${task.name}\` at another stop on line ${task.line}. Count the stops: this task wants stop number ${task.hit ?? 1}.`
        : `Not this value. Stop on line ${task.line}${(task.hit ?? 1) > 1 ? ` for the ${ordinal(task.hit!)} time` : ''}, and read \`${task.name}\` under Variables. The line has not run yet when the debugger stops on it.`;
    }
    if (note) {
      feedback.replaceChildren(panel('bad', 'Not yet.', h('p', null, mdInline(note))));
      place(feedback.children);
      shake(checkButton);
    } else feedback.replaceChildren();
    finishIfDone();
  }

  function finishIfDone(): void {
    if (solved || done.size < step.tasks.length) return;
    solved = true;
    ctx.grade(wrong === 0);
    noteEvidence(ctx.lesson.id, step.objective, wrong === 0, 'debugger');
    ctx.done();
    checkButton.hidden = true;
    feedback.replaceChildren(panel('good', 'All tasks done.', step.after ? md(step.after, 'prose prose-small') : null));
    place(feedback.children);
  }

  function showHint(): void {
    if (hintsShown >= step.hints.length) return;
    const item = h('li', null, mdInline(step.hints[hintsShown]));
    hintList.append(item);
    place(item);
    hintsShown += 1;
    if (hintsShown >= step.hints.length) hintButton.hidden = true;
    else hintButton.querySelector('.btn-label')!.textContent = `Show a hint (${hintsShown + 1} of ${step.hints.length})`;
  }

  // The keys of VS Code. F5 and F11 would reload the page or go full screen.
  function onKey(event: KeyboardEvent): void {
    const move = event.key === 'F5' ? 'continue' : event.key === 'F10' ? 'over' : event.key === 'F11' ? (event.shiftKey ? 'out' : 'into') : null;
    if (!move) return;
    event.preventDefault();
    go(move);
  }
  window.addEventListener('keydown', onKey);

  paintBreakpoints();
  moveButtons.forEach((b) => (b.disabled = true));
  void runPython({ code: step.code, trace: true, cases: [{ stdin: step.stdin ?? [] }] }).then((r) => {
    if (disposed) return;
    result = r;
    pauses = pausesOf(r.steps);
    show();
  });

  ctx.dock.primary('Continue', false);
  ctx.dock.note('Use the debugger to answer the tasks.');
  return {
    el,
    dispose() {
      disposed = true;
      window.removeEventListener('keydown', onKey);
    },
  };
}

function ordinal(n: number): string {
  return n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
}
