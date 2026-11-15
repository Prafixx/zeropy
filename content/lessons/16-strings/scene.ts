// Scene of the "text in depth" hook: a text is a sealed row of characters.
// Read one place, read from the end, read a slice of places.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const word: BoxVar = {
  name: 'word',
  type: 'str',
  repr: "'Python'",
  items: [...'Python'].map((c) => ({ repr: `'${c}'`, type: 'str' })),
  size: 6,
  ref: 'word',
};
const text = (name: string, value: string): BoxVar => ({ name, type: 'str', repr: `'${value}'` });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const first = text('first', 'P');
  const last = text('last', 'n');
  return {
    beats: {
      empty: () => boxes.sync([]),
      row: () => boxes.sync([word]),
      first: () => boxes.sync([word, first], { pick: { from: 'word', index: 0, to: 'first' } }),
      last: () => boxes.sync([word, first, last], { pick: { from: 'word', index: 5, to: 'last' } }),
      slice: () =>
        boxes.sync([word, first, last, text('part', 'Pyt')], { pick: { from: 'word', index: 0, span: 3, to: 'part' } }),
      sealed: () => boxes.sync([word, first, last, text('part', 'Pyt')]),
    },
    dispose: () => boxes.dispose(),
  };
});
