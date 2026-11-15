// Scene of the "reading the docs" hook: a signature names the boxes of the
// desk. Each argument goes into one parameter; a missing optional argument
// gets its default.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar, CallFrame } from '@/kit';

const val = (name: string, repr: string, type: string): BoxVar => ({ name, repr, type });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const a = val('a', '3.14', 'float');
  const first: CallFrame = { name: 'round', vars: [val('number', '3.14159', 'float'), val('ndigits', '2', 'int')] };
  const second: CallFrame = { name: 'round', vars: [val('number', '7.6', 'float'), val('ndigits', 'None', 'NoneType')] };
  return {
    beats: {
      sig: () => boxes.sync([]),
      call: () => boxes.sync([], { frames: [first] }),
      back: () => boxes.sync([a], { frames: [], ret: { to: 'a', from: 0 } }),
      call2: () => boxes.sync([a], { frames: [second] }),
      back2: () => boxes.sync([a, val('b', '8', 'int')], { frames: [], ret: { to: 'b', from: 0 } }),
    },
    dispose: () => boxes.dispose(),
  };
});
