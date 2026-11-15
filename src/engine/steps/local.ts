// Work on the learner's own computer. The page cannot see that computer, so
// the learner runs public/check.py there and pastes the sealed block it
// prints. The block is read here, its seal is tested in Python, and the
// lesson's checks run over the facts in it.
import { confetti, place, shake } from '@/kit/motion';
import { runPython, warmPython } from '@/py/runner';
import { parseReport, reportSetup } from '../local-report';
import type { LocalStep } from '../types';
import { button, codeBlock, h, icon, md, mdInline, panel } from '../ui';
import type { StepContext, StepView } from './context';

const NOT_FOUND: Record<'missing' | 'incomplete' | 'no-seal', string> = {
  missing: 'There is no check block in the text. Copy all lines from `----- ZEROPY CHECK -----` to `----- END -----`.',
  incomplete: 'The end of the block is missing. Copy down to the line `----- END -----`.',
  'no-seal': 'The line `seal: ...` is missing. Copy the whole block, without changes.',
};

export function renderLocal(step: LocalStep, ctx: StepContext): StepView {
  void warmPython().catch(() => undefined);
  let attempts = 0;
  let hintsShown = 0;
  let solved = false;
  let disposed = false;

  const command = `python check.py ${step.task}`;
  const checkRows = step.checks.map((check) =>
    h('li', { class: 'check' }, h('span', { class: 'check-mark' }), h('span', null, mdInline(check.pass))),
  );
  const feedback = h('div', { class: 'exercise-feedback', 'aria-live': 'polite' });
  const hintList = h('ol', { class: 'hints' });
  const hintButton = button(`Show a hint (1 of ${step.hints.length})`, { kind: 'ghost', small: true, icon: 'bulb', onClick: showHint });

  const paste = h('textarea', {
    class: 'local-paste',
    rows: 8,
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '----- ZEROPY CHECK -----\n...\n----- END -----',
    'aria-label': 'The output of check.py',
  });
  const checkButton = button('Check my output', { kind: 'primary', small: true, icon: 'check', onClick: () => void check() });

  const download = h(
    'a',
    { class: 'btn btn-ghost btn-small', href: 'check.py', download: 'check.py' },
    icon('file', 16),
    h('span', { class: 'btn-label' }, 'Download check.py'),
  );
  const view = h('a', { href: 'check.py', target: '_blank', rel: 'noopener' }, 'read it first');

  const box = h(
    'div',
    { class: 'local-box' },
    h('div', { class: 'local-row' }, h('span', { class: 'local-num' }, '1'), h('div', null, h('p', null, 'Save ', h('code', null, 'check.py'), ' in the folder of this task. It only reads, and you can ', view, '.'), download)),
    h(
      'div',
      { class: 'local-row' },
      h('span', { class: 'local-num' }, '2'),
      h(
        'div',
        null,
        h('p', null, 'Open a terminal in that folder and run:'),
        codeBlock(command).el,
        h('p', { class: 'local-small' }, 'On macOS and Linux, type ', h('code', null, 'python3'), ' instead of ', h('code', null, 'python'), '.'),
      ),
    ),
    h('div', { class: 'local-row' }, h('span', { class: 'local-num' }, '3'), h('div', null, h('p', null, 'Paste everything that it prints here:'), paste, checkButton)),
  );

  const el = h(
    'div',
    { class: 'split split-wide' },
    h(
      'div',
      { class: 'split-text', 'data-enter': true },
      h('span', { class: 'tag tag-local' }, 'On your computer'),
      md(step.prompt),
      h('h3', { class: 'todo-title' }, 'Your work is done when'),
      h('ul', { class: 'checks' }, ...checkRows),
      feedback,
      hintList,
      h('div', { class: 'exercise-help' }, hintButton),
    ),
    h('div', { class: 'split-visual', 'data-enter': true }, box),
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

  function setChecks(states: (boolean | null)[]): void {
    checkRows.forEach((row, i) => {
      const state = states[i];
      row.classList.toggle('is-pass', state === true);
      row.classList.toggle('is-fail', state === false);
      row.querySelector('.check-mark')!.replaceChildren(state === null ? '' : icon(state ? 'check' : 'cross', 14));
    });
  }

  function say(kind: 'good' | 'bad', title: string, text?: string): void {
    feedback.replaceChildren(panel(kind, title, text ? h('p', null, mdInline(text)) : null));
    place(feedback.children);
    if (kind === 'bad') shake(box);
  }

  async function check(): Promise<void> {
    if (solved && paste.value.trim() === '') return;
    const parsed = parseReport(paste.value);
    if (!parsed.ok) {
      setChecks(step.checks.map(() => null));
      // check.py prints its list of tasks when it does not know the task.
      if (paste.value.includes('Name a task')) say('bad', 'Your check.py does not know this task.', 'It is an old version. Download `check.py` again (step 1), then run the command again.');
      else say('bad', 'No check output found.', NOT_FOUND[parsed.reason]);
      return;
    }
    const { fields } = parsed.report;
    if (fields.task !== step.task) {
      say('bad', 'This is the output of another task.', `This block is for \`${fields.task ?? '?'}\`. Run \`${command}\`.`);
      return;
    }
    if (Number(fields.check ?? 0) < (step.needs ?? 1)) {
      say('bad', 'Your check.py is old.', 'Download `check.py` again: this task needs a newer version.');
      return;
    }
    checkButton.disabled = true;
    try {
      const result = await runPython({
        code: '',
        cases: [{ setup: reportSetup(parsed.report) }],
        checks: [{ expr: 'sealed' }, ...step.checks.map((c) => ({ expr: c.expr, misconceptions: c.misconceptions }))],
      });
      if (disposed) return;
      attempts += 1;
      if (!result.checks[0]?.pass) {
        setChecks(step.checks.map(() => null));
        say('bad', 'The block was changed.', 'The seal does not match: some lines are not as `check.py` printed them. Run the command again and paste the whole block without changes.');
        return;
      }
      const own = result.checks.slice(1);
      setChecks(own.map((c) => c.pass));
      const failed = own.findIndex((c) => !c.pass);
      if (failed === -1) {
        if (!solved) {
          solved = true;
          ctx.grade(attempts === 1);
          ctx.done();
        }
        feedback.replaceChildren(panel('good', 'Your computer is ready for this step.', step.after ? md(step.after, 'prose prose-small') : null));
        place(feedback.children);
        confetti(checkButton, 16);
        return;
      }
      say('bad', 'Not yet.', own[failed].note ?? step.checks[failed].hint);
    } finally {
      checkButton.disabled = false;
    }
  }

  ctx.dock.primary('Continue', false);
  ctx.dock.note('Run check.py on your computer, then paste its output.');
  return {
    el,
    dispose() {
      disposed = true;
    },
  };
}
