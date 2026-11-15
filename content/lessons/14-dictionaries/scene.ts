// Scene of the "dictionaries" hook: places that have a key instead of a
// number. Read by key, change the value of a key, add a new pair.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const prices = (pairs: [string, number][]): BoxVar => ({
  name: 'prices',
  type: 'dict',
  repr: `{${pairs.map(([k, v]) => `'${k}': ${v}`).join(', ')}}`,
  items: pairs.map(([key, value]) => ({ key: `'${key}'`, repr: String(value), type: 'int' })),
  size: pairs.length,
  ref: 'menu',
});
const cost = { name: 'cost', type: 'int', repr: '4' };

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      empty: () => boxes.sync([]),
      create: () => boxes.sync([prices([['tea', 2], ['cake', 4]])]),
      read: () =>
        boxes.sync([prices([['tea', 2], ['cake', 4]]), cost], { pick: { from: 'prices', index: 1, to: 'cost' } }),
      change: () => boxes.sync([prices([['tea', 3], ['cake', 4]]), cost]),
      add: () => boxes.sync([prices([['tea', 3], ['cake', 4], ['milk', 1]]), cost]),
    },
    dispose: () => boxes.dispose(),
  };
});
