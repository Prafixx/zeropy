// Theory, predict, worked example, quiz and review steps.
import { place } from '@/kit/motion';
import { warmPython } from '@/py/runner';
import type { Card } from '../registry';
import { describeWait, gradeCard, noteAnswer, pickReview } from '../store';
import type { DrillStep, Item, PredictStep, QuizStep, ReviewStep, TheoryStep, WorkedStep } from '../types';
import { codeBlock, h, md, mdInline, panel } from '../ui';
import type { StepContext, StepView } from './context';
import { renderItem } from './item';
import type { ItemView } from './item';

export function renderTheory(step: TheoryStep, ctx: StepContext): StepView {
  const keys = (step.keys ?? []).map((key) =>
    h(
      'div',
      { class: 'keycard', 'data-enter': true },
      h('code', { class: 'keycard-code' }, key.code),
      h('span', { class: 'keycard-means' }, mdInline(key.means)),
    ),
  );
  const el = h(
    'div',
    { class: keys.length ? 'split' : 'single' },
    h('div', { class: 'split-text', 'data-enter': true }, md(step.body)),
    keys.length ? h('div', { class: 'split-visual keycards' }, ...keys) : null,
  );
  return { el, entered: () => ctx.done() };
}

export function renderPredict(step: PredictStep, ctx: StepContext): StepView {
  void warmPython().catch(() => undefined);
  const view = renderItem(step.item, (firstTry) => {
    ctx.grade(firstTry);
    noteAnswer(ctx.lesson.id, step.item.id, !firstTry);
    ctx.done();
  });
  ctx.dock.note('Predict first. Then Python shows the real output.');
  return { el: h('div', { class: 'single', 'data-enter': true }, view.el), dispose: view.dispose };
}

export function renderWorked(step: WorkedStep, ctx: StepContext): StepView {
  let shown = 0;
  let check: ItemView | null = null;
  let goals = 0;
  const rows = step.lines.map((line, i) =>
    h(
      'li',
      { class: `worked-row${line.goal ? ' has-goal' : ''}`, hidden: true },
      line.goal ? h('p', { class: 'worked-goal' }, h('span', { class: 'worked-goal-num' }, `Goal ${(goals += 1)}`), line.goal) : null,
      h('span', { class: 'worked-num' }, String(i + 1)),
      h('div', { class: 'worked-body' }, codeBlock(line.code).el, h('p', { class: 'worked-note' }, mdInline(line.note))),
    ),
  );
  const checkSlot = h('div', { class: 'worked-check' });
  const el = h(
    'div',
    { class: 'split' },
    h(
      'div',
      { class: 'split-text', 'data-enter': true },
      h('span', { class: 'tag' }, 'Solved example'),
      md(step.problem),
      h('p', { class: 'muted' }, 'Read one line at a time. Before each click, think: what must the next line do?'),
      checkSlot,
    ),
    h('div', { class: 'split-visual', 'data-enter': true }, h('ol', { class: 'worked' }, ...rows)),
  );

  function reveal(): void {
    const row = rows[shown];
    row.hidden = false;
    place(row);
    shown += 1;
    if (shown < rows.length) {
      ctx.dock.primary('Next line', true, reveal);
      ctx.dock.note(`Line ${shown} of ${rows.length}`);
      return;
    }
    ctx.dock.primary('Continue', false);
    ctx.dock.note('Answer the question to continue.');
    check = renderItem(step.check, (firstTry) => {
      ctx.grade(firstTry);
      noteAnswer(ctx.lesson.id, step.check.id, !firstTry);
      ctx.done();
    });
    checkSlot.append(h('h2', { class: 'worked-why' }, 'Explain it to yourself'), check.el);
    place(checkSlot);
    checkSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return { el, entered: reveal, dispose: () => check?.dispose() };
}

interface SequenceOptions {
  items: Item[];
  intro?: HTMLElement;
  onAnswer?: (index: number, firstTry: boolean) => HTMLElement | null;
  /** The lesson of each item (review cards come from many lessons). */
  lessonOf?: (index: number) => string;
}

/** Shows items one at a time. Shared by quiz and review. */
function renderSequence(ctx: StepContext, options: SequenceOptions): StepView {
  const slot = h('div', { class: 'sequence-slot' });
  const count = h('div', { class: 'sequence-count' });
  const el = h('div', { class: 'single', 'data-enter': true }, options.intro ?? null, count, slot);
  let current: ItemView | null = null;

  function show(index: number): void {
    current?.dispose();
    const total = options.items.length;
    count.replaceChildren(
      ...options.items.map((_, i) => h('i', { class: i < index ? 'is-done' : i === index ? 'is-now' : '' })),
      h('span', null, `Question ${index + 1} of ${total}`),
    );
    ctx.dock.primary(index + 1 < total ? 'Next question' : 'Continue', false);
    ctx.dock.note('');
    ctx.objective(options.items[index].objective);
    current = renderItem(options.items[index], (firstTry) => {
      ctx.grade(firstTry);
      noteAnswer(options.lessonOf?.(index) ?? ctx.lesson.id, options.items[index].id, !firstTry);
      const extra = options.onAnswer?.(index, firstTry);
      if (extra) {
        current!.el.append(extra);
        place(extra);
      }
      if (index + 1 < total) ctx.dock.primary('Next question', true, () => show(index + 1));
      else ctx.done();
    });
    slot.replaceChildren(current.el);
    if (index > 0) place(current.el);
  }

  if (options.items.length === 0) {
    slot.append(panel('info', 'Nothing to review yet.', 'Finish more lessons to fill your review list.'));
    return { el, entered: () => ctx.done() };
  }
  return { el, entered: () => show(0), dispose: () => current?.dispose() };
}

export function renderQuiz(step: QuizStep | DrillStep, ctx: StepContext): StepView {
  void warmPython().catch(() => undefined);
  return renderSequence(ctx, { items: step.items });
}

/** Review of cards. Also used by the review page. */
export function renderCards(ctx: StepContext, cards: Card[], introText: string): StepView {
  void warmPython().catch(() => undefined);
  return renderSequence(ctx, {
    items: cards.map((c) => c.item),
    lessonOf: (index) => cards[index].lessonId,
    intro: h('p', { class: 'muted sequence-intro' }, introText),
    onAnswer: (index, firstTry) => {
      const due = gradeCard(cards[index].cardId, firstTry);
      return h('p', { class: 'next-review' }, `You will see this card again ${describeWait(due)}.`);
    },
  });
}

export function renderReview(step: ReviewStep, ctx: StepContext): StepView {
  const cards = pickReview(ctx.lesson.id, ctx.lesson.order, step.count);
  const mixed = cards.some((c) => c.lessonId !== ctx.lesson.id);
  return renderCards(
    ctx,
    cards,
    mixed
      ? 'These questions mix this lesson with earlier lessons. Answer from memory. Do not look back.'
      : 'Answer from memory. Do not look back. Each card comes back later, just before you would forget it.',
  );
}

/** Questions from the "My mistakes" list. A first-try answer takes one off. */
export function renderPractice(ctx: StepContext, entries: { lessonId: string; item: Item }[]): StepView {
  return renderSequence(ctx, {
    items: entries.map((e) => e.item),
    lessonOf: (index) => entries[index].lessonId,
    intro: h('p', { class: 'muted sequence-intro' }, 'Questions you answered wrong before. Right on the first try: it leaves your list.'),
    onAnswer: (_, firstTry) =>
      h('p', { class: 'next-review' }, firstTry ? 'Fixed. This question is off your list.' : 'Still on your list. It comes back here next time.'),
  });
}
