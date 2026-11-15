// Scene of the "input and conversion" hook: the answer of input() arrives as
// text (blue card). int() makes a new value of another type (yellow card).
import { defineScene, variableBoxes } from '@/kit';

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const answer = { name: 'answer', type: 'str', repr: "'12'" };
  const age = { name: 'age', type: 'int', repr: '12' };
  const next = { name: 'next_age', type: 'int', repr: '13' };

  return {
    beats: {
      empty: () => boxes.sync([]),
      ask: () => boxes.sync([answer]),
      convert: () => boxes.sync([answer, age], { from: { age: 'answer' } }),
      compute: () => boxes.sync([answer, age, next], { from: { next_age: 'age' } }),
    },
    dispose: () => boxes.dispose(),
  };
});
