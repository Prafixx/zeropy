// Scene of the "comprehensions" hook: the loop that builds a new list - read
// each value, keep it only if it passes the test, store a changed value.
// A comprehension is the same three parts in one line.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const values = [4, 12, 7, 20];
const list = (name: string, items: number[], ref: string): BoxVar => ({
  name,
  type: 'list',
  repr: `[${items.join(', ')}]`,
  items: items.map((v) => ({ repr: String(v), type: 'int' })),
  size: items.length,
  ref,
});
const prices = list('prices', values, 'prices');
const num = (name: string, value: number): BoxVar => ({ name, type: 'int', repr: String(value) });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const read = (index: number, kept: number[]) =>
    boxes.sync([prices, list('big', kept, 'big'), num('p', values[index])], {
      pick: { from: 'prices', index, to: 'p' },
    });
  const keep = (index: number, kept: number[]) =>
    boxes.sync([prices, list('big', kept, 'big'), num('p', values[index])], { from: { big: 'p' } });
  return {
    beats: {
      list: () => boxes.sync([prices]),
      empty: () => boxes.sync([prices, list('big', [], 'big')]),
      first: () => read(0, []),
      second: () => read(1, []),
      keepSecond: () => keep(1, [24]),
      third: () => read(2, [24]),
      keepThird: () => keep(2, [24, 14]),
      fourth: () => read(3, [24, 14]),
      keepFourth: () => keep(3, [24, 14, 40]),
      oneLine: () => boxes.sync([prices, list('big', [24, 14, 40], 'big')]),
    },
    dispose: () => boxes.dispose(),
  };
});
