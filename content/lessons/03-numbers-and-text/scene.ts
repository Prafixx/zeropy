// Scene of the "numbers and text" hook: the same character, 5, as a number
// and as text. The card color shows the type; + does two different things.
import { defineScene, variableBoxes } from '@/kit';

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const a = { name: 'a', type: 'int', repr: '5' };
  const b = { name: 'b', type: 'str', repr: "'5'" };
  const c = { name: 'c', type: 'int', repr: '10' };
  const d = { name: 'd', type: 'str', repr: "'55'" };

  return {
    beats: {
      empty: () => boxes.sync([]),
      number: () => boxes.sync([a]),
      text: () => boxes.sync([a, b]),
      add: () => boxes.sync([a, b, c], { from: { c: 'a' } }),
      join: () => boxes.sync([a, b, c, d], { from: { d: 'b' } }),
    },
    dispose: () => boxes.dispose(),
  };
});
