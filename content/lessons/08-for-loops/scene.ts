// Scene of the "for and range" hook: range(4) is a row of four waiting
// values. In each round the loop variable takes the next one.
import { defineScene, variableBoxes } from '@/kit';

const values = ['0', '1', '2', '3'].map((repr) => ({ repr, type: 'int' }));
const n = (value: number) => ({ name: 'n', type: 'int', repr: String(value) });
const double = (value: number) => ({ name: 'double', type: 'int', repr: String(value) });
const feed = (taken: number) => ({ name: 'n', values, taken });
const computed = { double: 'n' };

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      empty: () => boxes.sync([]),
      row: () => boxes.sync([], { feed: feed(0) }),
      first: () => boxes.sync([n(0)], { feed: feed(1) }),
      block1: () => boxes.sync([n(0), double(0)], { feed: feed(1), from: computed }),
      second: () => boxes.sync([n(1), double(0)], { feed: feed(2) }),
      block2: () => boxes.sync([n(1), double(2)], { feed: feed(2), from: computed }),
      rest: () => boxes.sync([n(3), double(6)], { feed: feed(4), from: computed }),
      end: () => boxes.sync([n(3), double(6)]),
    },
    dispose: () => boxes.dispose(),
  };
});
