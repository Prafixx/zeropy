// Scene of the "names and objects" hook: `b = a` puts a second name on the
// same list. A change through one name is seen through the other. copy()
// makes a second list.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const list = (name: string, ref: string, values: number[]): BoxVar => ({
  name,
  type: 'list',
  repr: `[${values.join(', ')}]`,
  items: values.map((v) => ({ repr: String(v), type: 'int' })),
  size: values.length,
  ref,
});

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      empty: () => boxes.sync([]),
      create: () => boxes.sync([list('a', 'first', [1, 2])]),
      alias: () => boxes.sync([list('a', 'first', [1, 2]), list('b', 'first', [1, 2])]),
      change: () => boxes.sync([list('a', 'first', [1, 2, 3]), list('b', 'first', [1, 2, 3])]),
      read: () => boxes.sync([list('a', 'first', [1, 2, 3]), list('b', 'first', [1, 2, 3])]),
      copy: () =>
        boxes.sync([list('a', 'first', [1, 2, 3]), list('b', 'first', [1, 2, 3]), list('c', 'second', [1, 2, 3])]),
    },
    dispose: () => boxes.dispose(),
  };
});
