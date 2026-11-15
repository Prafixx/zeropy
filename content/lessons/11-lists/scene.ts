// Scene of the "lists" hook: one name for a row of numbered places. Read a
// place, change a place, add a place at the end.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxItem } from '@/kit';

const text = (value: string): BoxItem => ({ repr: `'${value}'`, type: 'str' });
const drinks = (...values: string[]) => ({
  name: 'drinks',
  type: 'list',
  repr: `[${values.map((v) => `'${v}'`).join(', ')}]`,
  items: values.map(text),
  size: values.length,
});
const second = { name: 'second', type: 'str', repr: "'milk'" };

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      empty: () => boxes.sync([]),
      create: () => boxes.sync([drinks('tea', 'milk', 'juice')]),
      read: () =>
        boxes.sync([drinks('tea', 'milk', 'juice'), second], { pick: { from: 'drinks', index: 1, to: 'second' } }),
      change: () => boxes.sync([drinks('water', 'milk', 'juice'), second]),
      append: () => boxes.sync([drinks('water', 'milk', 'juice', 'cola'), second]),
    },
    dispose: () => boxes.dispose(),
  };
});
