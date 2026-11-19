// Spaced review outside a lesson: all due cards, mixed across lessons.
import { place } from '@/kit/motion';
import { allCards } from './registry';
import { brand, settingsButton } from './settings-menu';
import { describeWait, dueCards, nextDue, seenCardCount } from './store';
import { button, h, panel, shuffle } from './ui';
import type { StepContext } from './steps/context';
import { renderCards } from './steps/simple';

export function mountReview(root: HTMLElement): () => void {
  let dispose: (() => void) | undefined;
  let primaryAction: () => void = () => undefined;
  const body = h('div', { class: 'step-body' });
  const note = h('div', { class: 'dock-note' });
  const primary = button('Continue', { kind: 'primary', icon: 'right', onClick: () => primaryAction() });
  const home = h('a', { class: 'btn btn-ghost', href: '#/' }, h('span', { class: 'btn-label' }, 'Back to the course'));

  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      h('header', { class: 'bar' }, brand(), h('div', { class: 'bar-title' }, h('span', { class: 'bar-kicker' }, 'Review'), h('span', null, 'Spaced practice')), h('div', { class: 'bar-spacer' }), settingsButton()),
      h('main', { class: 'player-main', tabindex: '0' }, h('h1', { class: 'sr-only' }, 'Review'), body),
      h('footer', { class: 'dock' }, home, note, primary),
    ),
  );

  function finish(): void {
    dispose?.();
    const due = nextDue();
    body.replaceChildren(
      h('div', { class: 'single' }, panel('good', 'Review done.', h('p', null, due ? `Your next review is ${describeWait(due)}.` : 'Come back after your next lesson.'))),
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
        panel(
          'info',
          'Nothing is due now.',
          h('p', null, seenCardCount() === 0 ? 'Finish a lesson first. Its questions will come back here.' : `Your next review is ${describeWait(due ?? 0)}.`),
        ),
        allCards().length > 0 ? button('Practice anyway', { kind: 'plain', onClick: () => start(true) }) : null,
      ),
    );
    place(body.children);
  }

  return () => dispose?.();
}
