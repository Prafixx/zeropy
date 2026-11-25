// Scene of the "fast and slow code" hook: find 41 in a sorted row of eight
// crates. One by one reads six places; halving reads two.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const VALUES = [3, 8, 15, 23, 30, 41, 56, 72];
const nums: BoxVar = {
  name: 'nums',
  type: 'list',
  repr: `[${VALUES.join(', ')}]`,
  items: VALUES.map((v) => ({ repr: String(v), type: 'int' })),
  size: VALUES.length,
};
const num = (name: string, value: number): BoxVar => ({ name, type: 'int', repr: String(value) });
const target = num('target', 41);

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      start: () => boxes.sync([nums, target]),
      // One by one: the sixth read finds it.
      linear: () => boxes.sync([nums, target, num('seen', 41), num('steps', 6)], { pick: { from: 'nums', index: 5, to: 'seen' } }),
      // Halving: the middle first.
      middle: () => boxes.sync([nums, target, num('seen', 23), num('steps', 1)], { pick: { from: 'nums', index: 3, to: 'seen' } }),
      right: () => boxes.sync([nums, target, num('seen', 41), num('steps', 2)], { pick: { from: 'nums', index: 5, to: 'seen' } }),
      million: () => boxes.sync([nums, target, num('seen', 41), num('steps', 2)]),
    },
    dispose: () => boxes.dispose(),
  };
});
