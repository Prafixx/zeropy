// Spaced review outside a lesson: all due cards, mixed across lessons.
import { place } from '@/kit/motion';
import { allCards } from './registry';
import { describeWait, dueCards, nextDue, seenCardCount } from './store';
import { button, emptyState, h, shuffle, titled } from './ui';
import type { StepContext } from './steps/context';
import { renderCards } from './steps/simple';

export function mountReview(root: HTMLElement): () => void {
  let dispose: (() => void) | undefined;
  let primaryAction: () => void = () => undefined;
  const body = h('div', { class: 'step-body' });
  const note = h('div', { class: 'dock-note' });
  const primary = button('Continue', { kind: 'primary', icon: 'right', onClick: () => primaryAction() });

  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      h('main', { class: 'player-main is-page', tabindex: '0' }, h('h1', { class: 'sr-only' }, 'Review'), body),
      h('footer', { class: 'dock' }, note, primary),
    ),
  );

  function finish(): void {
    dispose?.();
    const due = nextDue();
    body.replaceChildren(
      h(
        'div',
        { class: 'single' },
        titled('review', h('h1', { class: 'display' }, 'Review')),
        emptyState(
          'done',
          'Review done',
          due ? `Your next review is ${describeWait(due)}. Short tests after a pause make memory last.` : 'Come back after your next lesson.',
        ),
      ),
    );
    place(body.children);
    primary.hidden = true;
  }

  function start(practiceAll: boolean): void {
    const cards = practiceAll ? shuffle(allCards()).slice(0, 6) : shuffle(dueCards()).slice(0, 12);
    primary.hidden = false;
    const ctx: StepContext = {
      lesson: undefined as never,
      dock: {
        primary(label, enabled, onClick) {
          primary.querySelector('.btn-label')!.textContent = label === 'Continue' ? 'Finish' : label;
          primary.disabled = !enabled;
          primaryAction = onClick ?? finish;
        },
        note: (text) => (note.textContent = text),
      },
      done: () => ctx.dock.primary('Finish', true),
      objective: () => undefined,
      grade: () => undefined,
    };
    const view = renderCards(ctx, cards, 'Answer from memory. Cards from different lessons are mixed on purpose.');
    dispose = view.dispose;
    body.replaceChildren(view.el);
    place(view.el);
    view.entered?.();
  }

  if (dueCards().length > 0) start(false);
  else {
    primary.hidden = true;
    const due = nextDue();
    body.replaceChildren(
      h(
        'div',
        { class: 'single' },
        titled('review', h('h1', { class: 'display' }, 'Review')),
        emptyState(
          'rest',
          'Nothing is due now',
          seenCardCount() === 0 ? 'Finish a lesson first. Its questions will come back here, just before you would forget them.' : `Your next review is ${describeWait(due ?? 0)}.`,
          allCards().length > 0 ? button('Practice anyway', { kind: 'plain', onClick: () => start(true) }) : null,
        ),
      ),
    );
    place(body.children);
  }

  return () => dispose?.();
}
