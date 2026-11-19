// Playground: free code with the moving picture. Nothing is checked, and
// the code stays on the device (it goes into the progress file too).
import { place } from '@/kit/motion';
import { brand, settingsButton } from './settings-menu';
import { renderDemo } from './steps/demo';
import type { StepContext } from './steps/context';
import { loadCode, saveCode } from './store';
import type { DemoStep } from './types';
import { button, h } from './ui';

const STARTER = `# Your playground. Write any Python and press Run.
# Your code is saved on this computer.
name = "Ada"
apples = 3
pears = 5
fruit = apples + pears
print(name, "has", fruit, "pieces of fruit.")
`;

const INTRO = `Write any Python here and press **Run** (or **Ctrl + Enter**). Each line plays in the picture, one after the other.

- Nothing is checked here. Try ideas, break things, read the errors.
- \`input()\` works: the program asks you under the output.
- Your code is saved on this computer, and in your progress file.`;

/** The top bar of a page outside a lesson: brand, a title, settings. */
export function pageBar(kicker: string, title: string): HTMLElement {
  return h(
    'header',
    { class: 'bar' },
    brand(),
    h('div', { class: 'bar-title' }, h('span', { class: 'bar-kicker' }, kicker), h('span', null, title)),
    h('div', { class: 'bar-spacer' }),
    settingsButton(),
  );
}

const quietContext: StepContext = {
  lesson: undefined as never,
  dock: { primary: () => undefined, note: () => undefined },
  done: () => undefined,
  objective: () => undefined,
  grade: () => undefined,
};

export function mountPlayground(root: HTMLElement): () => void {
  const step: DemoStep = {
    type: 'demo',
    id: 'playground',
    objective: '',
    title: 'Playground',
    visual: 'variables',
    intro: INTRO,
    code: loadCode('playground', 'main') ?? STARTER,
    experiments: [],
  };
  const view = renderDemo(step, quietContext, { onEdit: (code) => saveCode('playground', 'main', code) });
  const reset = button('Start again', {
    kind: 'ghost',
    onClick: () => {
      if (!window.confirm('Delete your playground code and start again?')) return;
      view.setCode(STARTER);
      saveCode('playground', 'main', STARTER);
    },
  });
  const home = h('a', { class: 'btn btn-ghost', href: '#/' }, h('span', { class: 'btn-label' }, 'Back to the course'));
  const body = h('div', { class: 'step-body' }, view.el);

  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      pageBar('Playground', 'Your own code'),
      h('main', { class: 'player-main' }, body),
      h('footer', { class: 'dock' }, home, h('div', { class: 'dock-note' }), reset),
    ),
  );
  place(body.querySelectorAll('[data-enter]'));
  view.entered?.();
  return () => view.dispose?.();
}
