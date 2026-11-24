// One retrieval item: multiple choice, predict the output, find the error,
// order the lines, trace table or click the line. Used by the predict step,
// worked examples, quizzes, drills, investigate steps and spaced review.
import { glide, place, shake, stamp } from '@/kit/motion';
import { onPyStatus, runPython } from '@/py/runner';
import { samePrint, sameValue, traceRows } from '../trace-table';
import type { TraceRow } from '../trace-table';
import type { Slot } from '@/editor/editor';
import type { BlanksItem, DiagnoseItem, Item, McqItem, OrderItem, PredictItem, PyError, SpotItem, TraceItem } from '../types';
import { button, codeBlock, h, icon, md, mdInline, panel, shuffle } from '../ui';
import type { PanelKind } from '../ui';

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

/** A run as the order check compares it: what it printed, how it ended, the values at the end. */
interface Outcome {
  out: string;
  error: PyError | null;
  values: string;
}

async function outcomeOf(code: string, stdin: string[]): Promise<Outcome> {
  const result = await runPython({ code, cases: [{ stdin }] });
  const values = result.vars
    .map((v) => `${v.name}=${v.repr}`)
    .sort()
    .join('\n');
  return { out: normalize(result.stdout), error: result.error, values };
}

/** A shuffled order of the lines that does not read like the program itself. */
function shuffledOrder(lines: string[]): number[] {
  const source = lines.join('\n');
  let order = lines.map((_, i) => i);
  for (let tries = 0; tries < 20; tries += 1) {
    order = shuffle(order);
    if (order.map((i) => lines[i]).join('\n') !== source) break;
  }
  return order;
}

/** Removes the first `count` spaces of a highlighted line (they are in its first text nodes). */
function stripIndent(el: HTMLElement, count: number): void {
  let left = count;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (left > 0 && walker.nextNode()) {
    const node = walker.currentNode as Text;
    const spaces = /^ */.exec(node.data)![0].length;
    const cut = Math.min(spaces, left);
    node.data = node.data.slice(cut);
    left -= cut;
    if (node.data.length > 0) break;
  }
}

/**
 * Put the lines in order. The learner drags a line, or moves it with its
 * buttons (or Alt + arrow keys). Python is the judge: the order is run and
 * compared with the program of the lesson, so another order that does the
 * same is right too.
 */
function renderOrder(item: OrderItem, onDone: OnDone): ItemView {
  const source = item.code.replace(/\n+$/, '');
  const lines = source.split('\n');
  const runs = item.stdin ?? [[]];
  let order = shuffledOrder(lines);
  let wrongTries = 0;
  let solved = false;
  let busy = false;
  let disposed = false;
  let reference: Outcome[] | null = null;

  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  const list = h('ol', { class: 'order-list', 'aria-label': 'The lines of the program, in your order' });
  // Says where a line went, for screen readers.
  const moved = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const check = button('Check the order', { kind: 'plain', onClick: () => void submit() });
  const giveUp = button('Show the right order', { kind: 'ghost', small: true, onClick: () => showAnswer() });
  giveUp.hidden = true;
  // The indent is drawn as a margin, not as spaces: a long line that wraps
  // (on a phone) keeps its indent, and the indent is part of the answer.
  const indents = lines.map((text) => /^ */.exec(text)![0].length);
  const texts = lines.map((text, i) => {
    const el = h('span', { class: 'code-text' }, text.slice(indents[i]));
    el.style.setProperty('--indent', String(indents[i]));
    return el;
  });
  void import('@/editor/editor').then((m) => {
    m.highlightLines(texts, source);
    texts.forEach((el, i) => stripIndent(el, indents[i]));
  });

  const cards = lines.map((_, i) => {
    const up = h('button', { type: 'button', class: 'order-move', 'aria-label': 'Move this line up' }, icon('up', 16));
    const down = h('button', { type: 'button', class: 'order-move', 'aria-label': 'Move this line down' }, icon('down', 16));
    const card = h(
      'li',
      { class: 'order-card', tabindex: '0', 'aria-label': `Line: ${lines[i].trim()}`, 'data-code': lines[i] },
      h('span', { class: 'order-grip', 'aria-hidden': 'true' }, icon('grip', 16)),
      h('code', { class: 'order-code' }, texts[i]),
      h('span', { class: 'order-moves' }, up, down),
    );
    up.addEventListener('click', () => move(i, -1, up));
    down.addEventListener('click', () => move(i, 1, down));
    card.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      move(i, event.key === 'ArrowUp' ? -1 : 1, card);
    });
    card.addEventListener('pointerdown', (event) => {
      if ((event.target as Element).closest('button') || solved || busy || event.button !== 0) return;
      event.preventDefault();
      // The window follows the pointer: a moved card leaves the page for a
      // moment, which would end a pointer capture on the card itself.
      dragging = i;
      card.classList.add('is-dragging');
      window.addEventListener('pointermove', onDrag);
      window.addEventListener('pointerup', onDrop);
      window.addEventListener('pointercancel', onDrop);
    });
    return card;
  });
  list.append(...order.map((i) => cards[i]));

  let dragging: number | null = null;

  function onDrag(event: PointerEvent): void {
    if (dragging === null) return;
    const line = dragging;
    // The new place: after every other card whose middle is above the pointer.
    const target = order.filter((j) => {
      if (j === line) return false;
      const rect = cards[j].getBoundingClientRect();
      return rect.top + rect.height / 2 < event.clientY;
    }).length;
    const at = order.indexOf(line);
    if (target !== at) moveTo(at, target);
  }

  function onDrop(): void {
    if (dragging !== null) cards[dragging].classList.remove('is-dragging');
    dragging = null;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', onDrop);
    window.removeEventListener('pointercancel', onDrop);
  }

  function moveTo(from: number, to: number): void {
    glide(cards, () => {
      const [line] = order.splice(from, 1);
      order.splice(to, 0, line);
      list.append(...order.map((i) => cards[i]));
    });
    cards.forEach((card) => card.classList.remove('is-right'));
    moved.textContent = `Line moved to place ${to + 1} of ${order.length}.`;
  }

  function move(line: number, by: -1 | 1, keepFocus: HTMLElement): void {
    if (solved || busy) return;
    const at = order.indexOf(line);
    if (at + by < 0 || at + by >= order.length) return;
    moveTo(at, at + by);
    keepFocus.focus();
  }

  function say(kind: PanelKind, title: string, ...body: (Node | string | null)[]): void {
    feedback.replaceChildren(panel(kind, title, ...body));
    place(feedback.children);
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finish(firstTry: boolean): void {
    solved = true;
    check.hidden = true;
    giveUp.hidden = true;
    list.classList.add('is-solved');
    cards.forEach((card) => card.classList.add('is-right'));
    onDone(firstTry);
  }

  function showAnswer(): void {
    if (solved || busy) return;
    glide(cards, () => {
      order = lines.map((_, i) => i);
      list.append(...order.map((i) => cards[i]));
    });
    say('info', 'This is the order of the lesson.', md(item.explain, 'prose prose-small'));
    finish(false);
  }

  const stopStatus = onPyStatus((status) => {
    if (!solved) check.querySelector('.btn-label')!.textContent = status === 'loading' ? 'Python is starting…' : 'Check the order';
  });

  async function submit(): Promise<void> {
    if (solved || busy) return;
    busy = true;
    check.disabled = true;
    list.classList.add('is-busy');
    const mine = order.map((i) => lines[i]).join('\n');
    try {
      if (mine === source) {
        say('good', 'Correct.', md(item.explain, 'prose prose-small'));
        finish(wrongTries === 0);
        return;
      }
      reference ??= await Promise.all(runs.map((stdin) => outcomeOf(source, stdin)));
      const yours = await Promise.all(runs.map((stdin) => outcomeOf(mine, stdin)));
      if (disposed) return;
      const same = yours.every(
        (run, k) => !run.error && run.out === reference![k].out && run.values === reference![k].values,
      );
      if (same) {
        say('good', 'Correct. Your order is different from ours, but Python gives the same result.', md(item.explain, 'prose prose-small'));
        finish(wrongTries === 0);
        return;
      }
      wrongTries += 1;
      const bad = yours.findIndex((run, k) => run.error || run.out !== reference![k].out || run.values !== reference![k].values);
      const run = yours[bad];
      const want = reference[bad];
      const rightPlaces = order.filter((line, at) => lines[line] === lines[at]).length;
      order.forEach((line, at) => cards[line].classList.toggle('is-right', lines[line] === lines[at]));
      const places = h('p', null, `${rightPlaces} of ${lines.length} lines are in the right place (green).`);
      if (run.error) {
        const last = run.error.traceback.trim().split('\n').at(-1) ?? run.error.type;
        say('bad', 'Not yet. In your order, Python stops with an error:', h('pre', { class: 'out-text out-inline' }, last), places);
      } else if (run.out !== want.out) {
        say(
          'bad',
          'Not yet. Your order prints:',
          h('pre', { class: 'out-text out-inline' }, run.out || '(nothing)'),
          h('p', null, 'The program must print:'),
          h('pre', { class: 'out-text out-inline' }, want.out || '(nothing)'),
          places,
        );
      } else {
        say('bad', 'Not yet. It prints the right text, but some values at the end are different.', places);
      }
      shake(list);
      if (wrongTries >= 2) giveUp.hidden = false;
    } finally {
      busy = false;
      check.disabled = false;
      list.classList.remove('is-busy');
    }
  }

  const el = h(
    'div',
    { class: 'item' },
    md(item.prompt ?? 'The lines of a program are mixed up. **Put them in the right order.** Drag a line, or use its arrows.', 'prose item-prompt'),
    list,
    moved,
    h('div', { class: 'order-actions' }, check, giveUp),
    feedback,
  );
  return {
    el,
    dispose: () => {
      disposed = true;
      stopStatus();
      onDrop();
    },
  };
}

/**
 * Trace table: the learner is the computer. For each line that runs, they
 * write the new values. Tracing by hand is a skill of its own: novices who
 * learn it read code better (Xie, Nelson and Ko 2018).
 */
function renderTrace(item: TraceItem, onDone: OnDone): ItemView {
  const code = codeBlock(item.code, { numbers: true });
  const status = h('p', { class: 'muted' }, 'Python is starting…');
  const tableSlot = h('div', { class: 'trace-slot' });
  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  const check = button('Check the table', { kind: 'plain', onClick: () => submit() });
  const giveUp = button('Show the answers', { kind: 'ghost', small: true, onClick: () => showAnswers() });
  check.hidden = true;
  giveUp.hidden = true;
  let disposed = false;
  let solved = false;
  let wrongTries = 0;

  interface Cell {
    input: HTMLInputElement;
    row: number;
    name: string | null;
    real: { repr: string; type: string } | string;
  }
  const cells: Cell[] = [];
  let rows: TraceRow[] = [];

  function say(kind: PanelKind, title: string, ...body: (Node | string | null)[]): void {
    feedback.replaceChildren(panel(kind, title, ...body));
    place(feedback.children);
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const right = (cell: Cell): boolean =>
    typeof cell.real === 'string' ? samePrint(cell.input.value, cell.real) : sameValue(cell.input.value, cell.real);

  function finish(firstTry: boolean): void {
    solved = true;
    check.hidden = true;
    giveUp.hidden = true;
    code.setActive(null);
    cells.forEach((c) => (c.input.readOnly = true));
    onDone(firstTry);
  }

  function submit(): void {
    if (solved) return;
    const wrong = cells.filter((c) => !right(c));
    cells.forEach((c) => {
      const ok = !wrong.includes(c);
      c.input.classList.toggle('is-right', ok);
      c.input.classList.toggle('is-wrong', !ok);
      if (ok) c.input.readOnly = true;
    });
    if (wrong.length === 0) {
      say('good', wrongTries === 0 ? 'Correct. You ran the program in your head.' : 'Correct. Now the table is right.', md(item.explain, 'prose prose-small'));
      finish(wrongTries === 0);
      return;
    }
    wrongTries += 1;
    const first = wrong[0];
    const line = rows[first.row].line;
    // A value that belongs to another row: the learner skipped or mixed up a line.
    const elsewhere =
      first.name !== null &&
      rows.some((r, i) => i !== first.row && r.values[first.name!] && sameValue(first.input.value, r.values[first.name!]));
    const where = `Line ${line} (row ${first.row + 1})`;
    const tip = elsewhere
      ? `${where}: this value of \`${first.name}\` comes from another row. Go one line at a time: what is \`${first.name}\` right after line ${line} runs?`
      : first.name === null
        ? `${where}: what does this line print? Use the values in the rows above.`
        : `${where}: use the values in the rows above to work out the new \`${first.name}\`.`;
    say('bad', `${cells.length - wrong.length} of ${cells.length} boxes are right. Fix the red ones.`, h('p', null, mdInline(tip)));
    shake(first.input);
    first.input.focus();
    if (wrongTries >= 2) giveUp.hidden = false;
  }

  function showAnswers(): void {
    if (solved) return;
    cells.forEach((c) => {
      if (right(c)) return;
      c.input.value = typeof c.real === 'string' ? c.real : c.real.repr;
      c.input.classList.remove('is-wrong');
      c.input.classList.add('is-shown');
    });
    say('info', 'These are the values of the real run.', md(item.explain, 'prose prose-small'));
    finish(false);
  }

  function build(found: TraceRow[]): void {
    rows = found;
    const prints = rows.some((r) => r.prints !== null);
    const head = h(
      'tr',
      null,
      h('th', { scope: 'col' }, 'Line'),
      ...item.names.map((name) => h('th', { scope: 'col' }, h('code', null, name))),
      prints ? h('th', { scope: 'col' }, 'Prints') : null,
    );
    const body = rows.map((row, r) => {
      const cell = (name: string | null, real: Cell['real'] | undefined): HTMLElement => {
        if (real === undefined) return h('td', { class: 'trace-same' });
        const label = name === null ? `What line ${row.line} prints (row ${r + 1})` : `Value of ${name} after line ${row.line} (row ${r + 1})`;
        const input = h('input', {
          class: name === null ? 'trace-cell is-print' : 'trace-cell',
          type: 'text',
          spellcheck: 'false',
          autocomplete: 'off',
          autocapitalize: 'off',
          'aria-label': label,
        });
        input.addEventListener('focus', () => {
          if (!solved) code.setActive(row.line);
        });
        input.addEventListener('input', () => input.classList.remove('is-wrong'));
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const at = cells.findIndex((c) => c.input === input);
          const next = cells.slice(at + 1).find((c) => !c.input.readOnly);
          if (next && !event.ctrlKey) next.input.focus();
          else submit();
        });
        cells.push({ input, row: r, name, real });
        return h('td', null, input);
      };
      return h(
        'tr',
        null,
        h('th', { scope: 'row', class: 'trace-line' }, String(row.line)),
        ...item.names.map((name) => cell(name, row.values[name])),
        prints ? cell(null, row.prints ?? undefined) : null,
      );
    });
    tableSlot.replaceChildren(
      h(
        'div',
        { class: 'trace-scroll' },
        h('table', { class: 'trace-table' }, h('thead', null, head), h('tbody', null, ...body)),
      ),
    );
    check.hidden = false;
    place(tableSlot);
  }

  void runPython({ code: item.code, trace: true, cases: [{ stdin: item.stdin ?? [] }] }).then((result) => {
    if (disposed) return;
    status.remove();
    build(traceRows(result.steps, result.stdout, item.names));
  });

  const el = h(
    'div',
    { class: 'item' },
    md(
      item.prompt ??
        '**Be the computer.** Each row is one line that runs, in order. Write the new value of each variable in the box. An empty space means: no change. Use the rows above to know the values so far.',
      'prose item-prompt',
    ),
    h('div', { class: 'trace-grid' }, code.el, h('div', null, status, tableSlot)),
    h('div', { class: 'order-actions' }, check, giveUp),
    feedback,
  );
  return { el, dispose: () => (disposed = true) };
}

/** Click the line: a question about what one line of a program does. */
function renderSpot(item: SpotItem, onDone: OnDone): ItemView {
  const code = codeBlock(item.code, { numbers: true });
  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  let wrongTries = 0;
  let solved = false;

  function pick(line: number): void {
    if (solved) return;
    const row = code.lines[line - 1];
    if (line === item.line) {
      solved = true;
      code.lines.forEach((r) => r.classList.remove('is-wrong'));
      row.classList.add('is-right');
      code.el.classList.remove('is-pickable');
      feedback.replaceChildren(panel('good', `Correct: line ${line}.`, md(item.explain, 'prose prose-small')));
      onDone(wrongTries === 0);
    } else {
      wrongTries += 1;
      row.classList.add('is-wrong');
      shake(row);
      const known = item.wrong?.find((w) => w.line === line);
      feedback.replaceChildren(
        panel('bad', `Not line ${line}.`, known ? h('p', null, mdInline(known.say)) : null, h('p', { class: 'muted' }, 'Choose again.')),
      );
    }
    place(feedback.children);
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  code.el.classList.add('is-pickable');
  code.lines.forEach((row, i) => {
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Line ${i + 1}`);
    row.addEventListener('click', () => pick(i + 1));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick(i + 1);
      }
    });
  });

  const el = h('div', { class: 'item' }, md(`${item.prompt} *Click the line.*`, 'prose item-prompt'), code.el, feedback);
  return { el, dispose: () => undefined };
}

const BLANK = /\[\?(.*?)\?\]/g;

/**
 * Fill in the blanks. The code is shown with a field for each `[?answer?]`.
 * Our answers are right at once; other answers are right when the program
 * prints the same and ends with the same values (Python is the judge).
 */
function renderBlanks(item: BlanksItem, onDone: OnDone): ItemView {
  const raw = item.code.replace(/\n+$/, '');
  const answers: string[] = [];
  const slots: Slot[] = [];
  // The program with our answers in it, and where each blank sits in it.
  const lines = raw.split('\n').map((line, at) => {
    let out = '';
    let last = 0;
    for (const m of line.matchAll(BLANK)) {
      out += line.slice(last, m.index);
      const from = out.length;
      out += m[1];
      answers.push(m[1]);
      const input = h('input', {
        class: 'blank-input',
        type: 'text',
        spellcheck: 'false',
        autocomplete: 'off',
        autocapitalize: 'off',
      }) as HTMLInputElement;
      input.style.width = `${Math.max(3, m[1].length + 1.5)}ch`;
      slots.push({ line: at, from, to: out.length, el: input });
      last = (m.index ?? 0) + m[0].length;
    }
    return out + line.slice(last);
  });
  const reference = lines.join('\n');
  const inputs = slots.map((s) => s.el as HTMLInputElement);
  inputs.forEach((input, i) => input.setAttribute('aria-label', `Blank ${i + 1} of ${inputs.length}`));
  const runs = item.stdin ?? [[]];
  let wrongTries = 0;
  let solved = false;
  let busy = false;
  let disposed = false;
  let expected: Outcome[] | null = null;

  // The code, first plain (fields in their places), then highlighted.
  const texts = lines.map((line, at) => {
    const el = h('span', { class: 'code-text' });
    let pos = 0;
    for (const slot of slots.filter((s) => s.line === at)) {
      el.append(line.slice(pos, slot.from), slot.el);
      pos = slot.to;
    }
    el.append(line.slice(pos) || (pos === 0 ? '​' : ''));
    return el;
  });
  const rows = texts.map((el, i) => h('div', { class: 'code-line' }, h('span', { class: 'code-num', 'aria-hidden': 'true' }, String(i + 1)), el));
  const code = h('pre', { class: 'code is-blanks' }, ...rows);
  void import('@/editor/editor').then((m) => m.highlightWithSlots(texts, reference, slots));

  const feedback = h('div', { class: 'item-feedback', 'aria-live': 'polite' });
  const check = button('Check', { kind: 'plain', onClick: () => void submit() });
  const giveUp = button('Show the answer', { kind: 'ghost', small: true, onClick: () => showAnswer() });
  giveUp.hidden = true;
  inputs.forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    });
    input.addEventListener('input', () => input.classList.remove('is-right'));
  });

  function say(kind: PanelKind, title: string, ...body: (Node | string | null)[]): void {
    feedback.replaceChildren(panel(kind, title, ...body));
    place(feedback.children);
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finish(firstTry: boolean): void {
    solved = true;
    check.hidden = true;
    giveUp.hidden = true;
    inputs.forEach((input) => {
      input.readOnly = true;
      input.classList.add('is-right');
    });
    onDone(firstTry);
  }

  function showAnswer(): void {
    if (solved || busy) return;
    inputs.forEach((input, i) => (input.value = answers[i]));
    say('info', 'These are our answers.', md(item.explain, 'prose prose-small'));
    finish(false);
  }

  const stopStatus = onPyStatus((status) => {
    if (!solved) check.querySelector('.btn-label')!.textContent = status === 'loading' ? 'Python is starting…' : 'Check';
  });

  async function submit(): Promise<void> {
    if (solved || busy) return;
    const values = inputs.map((input) => input.value.trim());
    const empty = values.findIndex((v) => v === '');
    if (empty >= 0) {
      say('info', inputs.length > 1 ? 'Fill in every blank first.' : 'Fill in the blank first.');
      inputs[empty].focus();
      return;
    }
    if (values.every((v, i) => v === answers[i].trim())) {
      say('good', 'Correct.', md(item.explain, 'prose prose-small'));
      finish(wrongTries === 0);
      return;
    }
    busy = true;
    check.disabled = true;
    code.classList.add('is-busy');
    let k = 0;
    const mine = raw.replace(BLANK, () => values[k++]);
    try {
      expected ??= await Promise.all(runs.map((stdin) => outcomeOf(reference, stdin)));
      const yours = await Promise.all(runs.map((stdin) => outcomeOf(mine, stdin)));
      if (disposed) return;
      const same = yours.every((run, n) => !run.error && run.out === expected![n].out && run.values === expected![n].values);
      if (same) {
        say('good', 'Correct. Your answer is different from ours, but Python gives the same result.', md(item.explain, 'prose prose-small'));
        finish(wrongTries === 0);
        return;
      }
      wrongTries += 1;
      inputs.forEach((input, i) => input.classList.toggle('is-right', values[i] === answers[i].trim()));
      const known = item.misconceptions?.find((m) => values[m.blank - 1] === m.answer.trim());
      const hint = known ? h('p', null, mdInline(known.say)) : null;
      const bad = yours.findIndex((run, n) => run.error || run.out !== expected![n].out || run.values !== expected![n].values);
      const run = yours[bad];
      const want = expected[bad];
      if (run.error) {
        const last = run.error.traceback.trim().split('\n').at(-1) ?? run.error.type;
        say('bad', 'Not yet. With your answer, Python stops with an error:', h('pre', { class: 'out-text out-inline' }, last), hint);
      } else if (run.out !== want.out) {
        say(
          'bad',
          'Not yet. With your answer, the program prints:',
          h('pre', { class: 'out-text out-inline' }, run.out || '(nothing)'),
          h('p', null, 'It must print:'),
          h('pre', { class: 'out-text out-inline' }, want.out || '(nothing)'),
          hint,
        );
      } else {
        say('bad', 'Not yet. It prints the right text, but some values at the end are different.', hint);
      }
      shake(code);
      if (wrongTries >= 2) giveUp.hidden = false;
    } finally {
      busy = false;
      check.disabled = false;
      code.classList.remove('is-busy');
    }
  }

  const el = h(
    'div',
    { class: 'item' },
    md(item.prompt ?? 'Fill in the blanks.', 'prose item-prompt'),
    code,
    h('div', { class: 'order-actions' }, check, giveUp),
    feedback,
  );
  return {
    el,
    dispose() {
      disposed = true;
      stopStatus();
    },
  };
}

export function renderItem(item: Item, onDone: OnDone): ItemView {
  if (item.kind === 'mcq') return renderMcq(item, onDone);
  if (item.kind === 'predict') return renderPredict(item, onDone);
  if (item.kind === 'order') return renderOrder(item, onDone);
  if (item.kind === 'trace') return renderTrace(item, onDone);
  if (item.kind === 'spot') return renderSpot(item, onDone);
  if (item.kind === 'blanks') return renderBlanks(item, onDone);
  return renderDiagnose(item, onDone);
}
