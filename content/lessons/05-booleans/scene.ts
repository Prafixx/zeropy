// Scene of the "True and False" hook: a comparison is a question. Python
// answers once, with a green True/False card, and stores that answer.
import { defineScene, variableBoxes } from '@/kit';

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const age = (value: number) => ({ name: 'age', type: 'int', repr: String(value) });
  const adult = (value: boolean) => ({ name: 'is_adult', type: 'bool', repr: value ? 'True' : 'False' });

  return {
    beats: {
      empty: () => boxes.sync([]),
      age: () => boxes.sync([age(16)]),
      ask: () => boxes.sync([age(16), adult(false)], { from: { is_adult: 'age' } }),
      change: () => boxes.sync([age(21), adult(false)]),
      again: () => boxes.sync([age(21), adult(true)], { from: { is_adult: 'age' } }),
    },
    dispose: () => boxes.dispose(),
  };
});
