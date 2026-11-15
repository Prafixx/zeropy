// One retrieval item (multiple choice or predict-the-output). Used by the
// predict step, worked examples, quizzes and spaced review.
import { confetti, place, shake, stamp } from '@/kit/motion';
import { onPyStatus, runPython } from '@/py/runner';
import type { DiagnoseItem, Item, McqItem, PredictItem, PyError } from '../types';
import { button, codeBlock, h, md, mdInline, panel, shuffle } from '../ui';

export interface ItemView {
  el: HTMLElement;
  dispose(): void;
}

type OnDone = (firstTry: boolean) => void;

function normalize(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function renderMcq(item: McqItem, onDone: OnDone): ItemView {
  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  let wrongTries = 0;
  let solved = false;
  const options = shuffle(item.options).map((option, i) => {
    const el = h(
      'button',
      { type: 'button', class: 'option' },
      h('span', { class: 'option-key' }, String.fromCharCode(65 + i)),
      h('span', { class: 'option-text' }, mdInline(option.text)),
    );
    el.addEventListener('click', () => {
      if (solved || el.disabled) return;
      if (option.correct) {
        solved = true;
        el.classList.add('is-right');
        options.forEach((o) => (o.disabled = true));
        const mark = h('span', { class: 'stamp' }, 'Correct');
        feedback.replaceChildren(panel('good', 'Correct.', mdInline(option.why)));
        el.append(mark);
        stamp(mark);
        if (wrongTries === 0) confetti(el, 10);
        onDone(wrongTries === 0);
      } else {
        wrongTries += 1;
        el.classList.add('is-wrong');
        el.disabled = true;
        feedback.replaceChildren(panel('bad', 'Not this one.', mdInline(option.why), h('p', { class: 'muted' }, 'Choose again.')));
        shake(el);
      }
      place(feedback.children);
      feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return el;
  });
  const el = h(
    'div',
    { class: 'item' },
    md(item.prompt, 'prose item-prompt'),
    item.code ? codeBlock(item.code, { numbers: true }).el : null,
    h('div', { class: 'options', role: 'group', 'aria-label': 'Answers' }, ...options),
    feedback,
  );
  return { el, dispose: () => undefined };
}

function renderPredict(item: PredictItem, onDone: OnDone): ItemView {
  const input = h('textarea', {
    class: 'predict-input',
    rows: '2',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-label': 'Your prediction of the output',
    placeholder: 'Type the exact output',
  });
  const check = button('Check my prediction', { kind: 'plain', onClick: () => void submit() });
  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  check.disabled = true;
  let disposed = false;
  let answered = false;

  input.addEventListener('input', () => {
    check.disabled = answered || input.value.trim() === '';
    // Grow with the answer: some programs print several lines.
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 4}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit();
  });
  const stopStatus = onPyStatus((status) => {
    if (!answered) check.querySelector('.btn-label')!.textContent = status === 'loading' ? 'Python is starting…' : 'Check my prediction';
  });

  async function submit(): Promise<void> {
    if (answered || input.value.trim() === '') return;
    answered = true;
    check.disabled = true;
    input.readOnly = true;
    const result = await runPython({ code: item.code, cases: [{ files: item.files, web: item.web }] });
    if (disposed) return;
    const actual = normalize(result.error ? result.error.traceback : result.stdout);
    const guess = normalize(input.value);
    const correct = guess === actual;
    const real = h('pre', { class: 'out-text out-inline' }, actual || '(nothing)');
    if (correct) {
      input.classList.add('is-right');
      feedback.replaceChildren(panel('good', 'Correct. Python prints:', real, md(item.explain, 'prose prose-small')));
      confetti(input, 10);
    } else {
      input.classList.add('is-wrong');
      const known = item.misconceptions?.find((m) => normalize(m.answer) === guess);
      feedback.replaceChildren(
        panel(
          'bad',
          'Not yet. Python prints:',
          real,
          known ? h('p', null, mdInline(known.say)) : null,
          md(item.explain, 'prose prose-small'),
        ),
      );
      shake(input);
    }
    place(feedback.children);
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    onDone(correct);
  }

  const el = h(
    'div',
    { class: 'item' },
    md(item.prompt ?? 'Read the code. **What does it print?** Decide before you run it.', 'prose item-prompt'),
    codeBlock(item.code, { numbers: true }).el,
    h('div', { class: 'predict-row' }, input, check),
    feedback,
  );
  return {
    el,
    dispose: () => {
      disposed = true;
      stopStatus();
    },
  };
}

const COMMON_ERRORS = ['SyntaxError', 'IndentationError', 'NameError', 'TypeError', 'ValueError', 'ZeroDivisionError'];

/**
 * Find the error. The answer key is the real run: the line and the kind of
 * error come from Python, not from the lesson file.
 */
function renderDiagnose(item: DiagnoseItem, onDone: OnDone): ItemView {
  const predict = item.mode === 'predict';
  const code = codeBlock(item.code, { numbers: true });
  const trace = h('pre', { class: 'traceback', hidden: predict });
  const typeRow = h('div', { class: 'diag-types', role: 'group', 'aria-label': 'Kinds of error' });
  const lineTask = h(
    'div',
    { class: 'diag-task' },
    h('span', { class: 'diag-num' }, '1'),
    h('span', null, predict ? 'Click the line where Python will stop.' : 'Click the line where Python stopped.'),
  );
  const typeTask = h(
    'div',
    { class: 'diag-task', hidden: !predict },
    h('span', { class: 'diag-num' }, '2'),
    h('span', null, predict ? 'Which kind of error will it be?' : 'Which kind of error is it?'),
  );
  typeRow.hidden = !predict;
  const check = button('Check with Python', { kind: 'plain', onClick: () => reveal() });
  check.hidden = !predict;
  check.disabled = true;
  const status = h('p', { class: 'muted' }, 'Python is starting…');
  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  const fixSlot = h('div', { class: 'diag-fix' });

  let error: PyError | null = null;
  let disposed = false;
  let mistakes = 0;
  let lineDone = false;
  let typeDone = false;
  let pickedLine: number | null = null;
  let pickedType: string | null = null;
  let revealed = false;
  let fixView: ItemView | null = null;
  const typeButtons = new Map<string, HTMLButtonElement>();

  function say(kind: 'good' | 'bad', title: string, ...body: (Node | string | null)[]): void {
    feedback.replaceChildren(panel(kind, title, ...body));
    place(feedback.children);
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finish(): void {
    const explain = md(item.explain, 'prose prose-small');
    if (!item.fix) {
      feedback.append(explain);
      onDone(mistakes === 0);
      return;
    }
    // Last question: how to fix it. Same rules as a multiple-choice item.
    fixView = renderMcq(
      { kind: 'mcq', id: `${item.id}-fix`, objective: item.objective, prompt: '**How do you fix it?**', options: item.fix },
      (firstTry) => {
        fixSlot.append(explain);
        onDone(firstTry && mistakes === 0);
      },
    );
    fixSlot.replaceChildren(fixView.el);
    place(fixSlot);
    fixSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function pickLine(line: number): void {
    if (!error || lineDone || revealed) return;
    const row = code.lines[line - 1];
    if (predict) {
      pickedLine = line;
      code.lines.forEach((r, i) => r.classList.toggle('is-pick', i === line - 1));
      check.disabled = pickedType === null;
      return;
    }
    if (line === error.line) {
      lineDone = true;
      code.lines.forEach((r) => r.classList.remove('is-wrong'));
      row.classList.add('is-right');
      feedback.replaceChildren();
      typeTask.hidden = false;
      typeRow.hidden = false;
      place([typeTask, typeRow]);
    } else {
      mistakes += 1;
      row.classList.add('is-wrong');
      shake(row);
      say('bad', 'Not this line.', 'Find the word "line" in the message. The number after it is the place.');
    }
  }

  function pickType(type: string): void {
    if (!error || typeDone || revealed) return;
    const el = typeButtons.get(type)!;
    if (predict) {
      pickedType = type;
      typeButtons.forEach((b, name) => b.classList.toggle('is-pick', name === type));
      check.disabled = pickedLine === null;
      return;
    }
    if (type === error.type) {
      typeDone = true;
      el.classList.add('is-right');
      typeButtons.forEach((b) => (b.disabled = true));
      say('good', 'Right.', `Line ${error.line}, ${error.type}. Now you know where and what.`);
      finish();
    } else {
      mistakes += 1;
      el.classList.add('is-wrong');
      el.disabled = true;
      shake(el);
      say('bad', 'Not this one.', 'The last line of the message starts with the kind of error.');
    }
  }

  // Predict mode: one answer, then Python shows what really happens.
  function reveal(): void {
    if (!error || revealed || pickedLine === null || pickedType === null) return;
    const real = error;
    revealed = true;
    check.hidden = true;
    trace.hidden = false;
    place(trace);
    const lineOk = pickedLine === real.line;
    const typeOk = pickedType === real.type;
    code.lines.forEach((r) => r.classList.remove('is-pick'));
    if (!lineOk) code.lines[pickedLine - 1].classList.add('is-wrong');
    if (real.line) code.lines[real.line - 1]?.classList.add('is-right');
    typeButtons.forEach((b, name) => {
      b.classList.remove('is-pick');
      b.disabled = true;
      if (name === real.type) b.classList.add('is-right');
      else if (name === pickedType) b.classList.add('is-wrong');
    });
    if (!lineOk || !typeOk) mistakes += 1;
    const facts = `Python stops on line ${real.line} with a ${real.type}.`;
    if (lineOk && typeOk) {
      say('good', 'Correct.', facts);
      confetti(trace, 10);
    } else {
      const title = lineOk
        ? 'The line is right, the kind of error is not.'
        : typeOk
          ? 'The kind of error is right, the line is not.'
          : 'Not yet.';
      say('bad', title, facts);
    }
    finish();
  }

  code.el.classList.add('is-pickable');
  code.lines.forEach((row, i) => {
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Line ${i + 1}`);
    row.addEventListener('click', () => pickLine(i + 1));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pickLine(i + 1);
      }
    });
  });

  void runPython({ code: item.code, cases: [{ files: item.files, web: item.web }] }).then((result) => {
    if (disposed) return;
    status.remove();
    const real = result.error;
    if (!real || real.line === null) {
      // Should not happen: check-content tests every diagnose item.
      say('good', 'This program has no error.', 'Continue with the next question.');
      onDone(true);
      return;
    }
    error = real;
    trace.textContent = real.traceback;
    const wrong = shuffle((item.distractors ?? COMMON_ERRORS).filter((name) => name !== real.type)).slice(0, 3);
    for (const name of shuffle([real.type, ...wrong])) {
      const el = h('button', { type: 'button', class: 'type-btn' }, name);
      el.addEventListener('click', () => pickType(name));
      typeButtons.set(name, el);
      typeRow.append(el);
    }
  });

  const el = h(
    'div',
    { class: 'item' },
    md(
      item.prompt ??
        (predict
          ? 'This program has a mistake. **Where will Python stop, and with which kind of error?** Decide before you check.'
          : 'This program stops with an error. **Read the message.**'),
      'prose item-prompt',
    ),
    code.el,
    trace,
    status,
    lineTask,
    typeTask,
    typeRow,
    check,
    feedback,
    fixSlot,
  );
  return {
    el,
    dispose: () => {
      disposed = true;
      fixView?.dispose();
    },
  };
}

export function renderItem(item: Item, onDone: OnDone): ItemView {
  if (item.kind === 'mcq') return renderMcq(item, onDone);
  if (item.kind === 'predict') return renderPredict(item, onDone);
  return renderDiagnose(item, onDone);
}
