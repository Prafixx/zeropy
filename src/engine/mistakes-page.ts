// "My mistakes": the questions answered wrong and the exercises that were
// hard, in one place. Practicing exactly these is the fastest way to close
// a gap; a question leaves the list when it is right on the first try.
import { place } from '@/kit/motion';
import { findRef } from './registry';
import type { StepContext } from './steps/context';
import { renderPractice } from './steps/simple';
import { mistakes } from './store';
import type { Item } from './types';
import { button, emptyState, h, icon, shuffle, titled } from './ui';

export function mountMistakes(root: HTMLElement): () => void {
  let dispose: (() => void) | undefined;
  let primaryAction: () => void = () => undefined;
  const body = h('div', { class: 'step-body' });
  const note = h('div', { class: 'dock-note', 'aria-live': 'polite' });
  const primary = button('Continue', { kind: 'primary', icon: 'right', onClick: () => primaryAction() });
  primary.hidden = true;

  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      h('main', { class: 'player-main is-page', tabindex: '0' }, body),
      h('footer', { class: 'dock' }, note, primary),
    ),
  );

  function collect(): { questions: { lessonId: string; item: Item }[]; exercises: HTMLElement[] } {
    const questions: { lessonId: string; item: Item }[] = [];
    const exercises: HTMLElement[] = [];
    for (const m of mistakes()) {
      const found = findRef(m.lessonId, m.ref);
      if (!found) continue;
      if (found.kind === 'item') questions.push({ lessonId: m.lessonId, item: found.item });
      else
        exercises.push(
          h(
            'li',
            { class: 'mistake-row' },
            h('span', { class: 'mistake-where' }, `From ${found.lesson.title}`),
            h('strong', null, found.step.title),
            h(
              'a',
              {
                class: 'btn btn-plain btn-small',
                // An extra exercise has no place in the lesson: it opens on its own.
                href: found.index === -1 ? `#/practice/lesson/${found.lesson.id}/${found.step.id}` : `#/lesson/${found.lesson.id}/${found.index + 1}`,
              },
              h('span', { class: 'btn-label' }, 'Do it again'),
              icon('right', 16),
            ),
          ),
        );
    }
    return { questions, exercises };
  }

  function overview(): void {
    dispose?.();
    dispose = undefined;
    primary.hidden = true;
    note.textContent = '';
    const { questions, exercises } = collect();
    if (questions.length === 0 && exercises.length === 0) {
      body.replaceChildren(
        h(
          'div',
          { class: 'single mistakes' },
          titled('mistakes', h('h1', { class: 'display' }, 'My mistakes')),
          emptyState(
            'done',
            'No mistakes to practice',
            'When you answer a question wrong, or need the solution of an exercise, it comes here. Then you can practice exactly that.',
          ),
        ),
      );
      place(body.children);
      return;
    }
    body.replaceChildren(
      h(
        'div',
        { class: 'single mistakes' },
        titled('mistakes', h('h1', { class: 'display' }, 'My mistakes')),
        h('p', { class: 'lead', 'data-enter': true }, 'Mistakes are where you learn the most. Practice them again until they leave this list.'),
        questions.length
          ? h(
              'section',
              { class: 'mistakes-part', 'data-enter': true },
              h('h2', { class: 'sheet-title' }, `Questions (${questions.length})`),
              h('p', { class: 'muted' }, 'Answer each one again, from memory. Right on the first try: it leaves the list.'),
              button(`Practice ${Math.min(questions.length, 10)} question${questions.length === 1 ? '' : 's'}`, {
                kind: 'primary',
                icon: 'loop',
                onClick: () => practice(questions),
              }),
            )
          : null,
        exercises.length
          ? h(
              'section',
              { class: 'mistakes-part', 'data-enter': true },
              h('h2', { class: 'sheet-title' }, `Exercises (${exercises.length})`),
              h('p', { class: 'muted' }, 'You needed the solution or many tries here. Solve it again in two runs or less, without the solution: it leaves the list.'),
              h('ul', { class: 'mistake-list' }, ...exercises),
            )
          : null,
      ),
    );
    place(body.querySelectorAll('[data-enter]'));
  }

  function practice(questions: { lessonId: string; item: Item }[]): void {
    const ctx: StepContext = {
      lesson: undefined as never,
      dock: {
        primary(label, enabled, onClick) {
          primary.querySelector('.btn-label')!.textContent = label === 'Continue' ? 'Finish' : label;
          primary.disabled = !enabled;
          primaryAction = onClick ?? overview;
        },
        note: (text) => (note.textContent = text),
      },
      done: () => ctx.dock.primary('Finish', true),
      objective: () => undefined,
      grade: () => undefined,
    };
    primary.hidden = false;
    const view = renderPractice(ctx, shuffle(questions).slice(0, 10));
    dispose = view.dispose;
    body.replaceChildren(view.el);
    place(view.el);
    view.entered?.();
  }

  overview();
  return () => dispose?.();
}
