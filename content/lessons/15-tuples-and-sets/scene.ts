// Scene of the "tuples and sets" hook: a tuple is a sealed row that can be
// unpacked into names; a set keeps each value once and has no numbers.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const point: BoxVar = {
  name: 'point',
  type: 'tuple',
  repr: '(3, 5)',
  items: [
    { repr: '3', type: 'int' },
    { repr: '5', type: 'int' },
  ],
  size: 2,
  ref: 'point',
};
const x = { name: 'x', type: 'int', repr: '3' };
const y = { name: 'y', type: 'int', repr: '5' };
const colors: BoxVar = {
  name: 'colors',
  type: 'set',
  repr: "{'blue', 'red'}",
  items: [
    { repr: "'blue'", type: 'str' },
    { repr: "'red'", type: 'str' },
  ],
  size: 2,
  ref: 'colors',
};

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      empty: () => boxes.sync([]),
      tuple: () => boxes.sync([point]),
      first: () => boxes.sync([point, x], { pick: { from: 'point', index: 0, to: 'x' } }),
      second: () => boxes.sync([point, x, y], { pick: { from: 'point', index: 1, to: 'y' } }),
      set: () => boxes.sync([point, x, y, colors]),
    },
    dispose: () => boxes.dispose(),
  };
});
