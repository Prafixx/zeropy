// Playground: free code with the moving picture. Nothing is checked, and
// the code stays on the device (it goes into the progress file too).
import { place } from '@/kit/motion';
import { confirmDialog } from './dialog';
import { renderDemo } from './steps/demo';
import type { StepContext } from './steps/context';
import { loadCode, saveCode } from './store';
import type { DemoStep } from './types';
import { button, h, titled } from './ui';

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
    onClick: async () => {
      const ok = await confirmDialog({
        title: 'Start again?',
        body: 'Your code in the playground is deleted, and the example comes back.',
        confirm: 'Delete my code',
        danger: true,
      });
      if (!ok) return;
      view.setCode(STARTER);
      saveCode('playground', 'main', STARTER);
    },
  });
  const body = h('div', { class: 'step-body' }, titled('playground', h('h1', { class: 'display' }, 'Playground')), view.el);

  root.replaceChildren(
    h(
      'div',
      { class: 'player' },
      h('main', { class: 'player-main', tabindex: '0' }, body),
      h('footer', { class: 'dock' }, h('div', { class: 'dock-note' }), reset),
    ),
  );
  place(body.querySelectorAll('[data-enter]'));
  view.entered?.();
  return () => view.dispose?.();
}
