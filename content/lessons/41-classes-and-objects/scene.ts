// Scene of the "classes and objects" hook: a class is a plan, and each
// object made from it is its own tray with its own values. Changing one
// object leaves the other alone. Inside a method, `self` is one more name
// on the object that the method was called on.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const dog = (name: string, ref: string, dogName: string, age: number): BoxVar => ({
  name,
  type: 'Dog',
  repr: '<Dog object>',
  object: true,
  items: [
    { key: 'name', repr: `'${dogName}'`, type: 'str' },
    { key: 'age', repr: String(age), type: 'int' },
  ],
  size: 2,
  ref,
});

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const ada = dog('ada', 'second', 'Ada', 5);
  return {
    beats: {
      plan: () => boxes.sync([]),
      make: () => boxes.sync([dog('rex', 'first', 'Rex', 3)]),
      second: () => boxes.sync([dog('rex', 'first', 'Rex', 3), ada]),
      change: () => boxes.sync([dog('rex', 'first', 'Rex', 4), ada]),
      method: () =>
        boxes.sync([dog('rex', 'first', 'Rex', 4), ada], {
          frames: [{ name: 'birthday', vars: [dog('self', 'first', 'Rex', 4)] }],
        }),
      older: () =>
        boxes.sync([dog('rex', 'first', 'Rex', 5), ada], {
          frames: [{ name: 'birthday', vars: [dog('self', 'first', 'Rex', 5)] }],
        }),
      done: () => boxes.sync([dog('rex', 'first', 'Rex', 5), ada]),
    },
    dispose: () => boxes.dispose(),
  };
});
