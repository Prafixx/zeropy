// Scene of the "loop patterns" hook: walk through a list once and keep the
// biggest value so far. Each place is read in turn; `biggest` changes only
// when a bigger value comes.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const values = [4, 9, 2, 7];
const prices: BoxVar = {
  name: 'prices',
  type: 'list',
  repr: `[${values.join(', ')}]`,
  items: values.map((v) => ({ repr: String(v), type: 'int' })),
  size: values.length,
};
const num = (name: string, value: number): BoxVar => ({ name, type: 'int', repr: String(value) });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const round = (index: number, best: number) =>
    boxes.sync([prices, num('biggest', best), num('p', values[index])], {
      pick: { from: 'prices', index, to: 'p' },
    });
  return {
    beats: {
      empty: () => boxes.sync([]),
      list: () => boxes.sync([prices]),
      start: () => boxes.sync([prices, num('biggest', 4)], { pick: { from: 'prices', index: 0, to: 'biggest' } }),
      first: () => round(0, 4),
      second: () => round(1, 4),
      better: () => boxes.sync([prices, num('biggest', 9), num('p', 9)], { from: { biggest: 'p' } }),
      third: () => round(2, 9),
      fourth: () => round(3, 9),
      end: () => boxes.sync([prices, num('biggest', 9), num('p', 7)]),
    },
    dispose: () => boxes.dispose(),
  };
});
