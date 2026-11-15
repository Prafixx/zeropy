// Scene of the Variables hook. It only tells the actor what the program
// state is after each line; the kit decides how that looks in 3D or 2D.
import { defineScene, variableBoxes } from '@/kit';

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const age = (value: number) => ({ name: 'age', type: 'int', repr: String(value) });
  const name = { name: 'name', type: 'str', repr: "'Mia'" };

  return {
    beats: {
      empty: () => boxes.sync([]),
      create: () => boxes.sync([age(25)]),
      second: () => boxes.sync([age(25), name]),
      replace: () => boxes.sync([age(26), name]),
      compute: () =>
        boxes.sync([age(26), name, { name: 'next_age', type: 'int', repr: '27' }], { from: { next_age: 'age' } }),
    },
    dispose: () => boxes.dispose(),
  };
});
