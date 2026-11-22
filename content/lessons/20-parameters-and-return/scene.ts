// Scene of the "parameters, return, scope" hook: a function calls another
// function. The first call waits on its desk while a second desk opens.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar, CallFrame } from '@/kit';

const num = (name: string, value: number): BoxVar => ({ name, type: 'int', repr: String(value) });
const int = (value: number) => ({ repr: String(value), type: 'int' });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const total: CallFrame = { name: 'total', vars: [num('a', 2), num('b', 3)] };
  const square = (n: number): CallFrame => ({ name: 'square', vars: [num('n', n)] });
  return {
    beats: {
      define: () => boxes.sync([]),
      outer: () => boxes.sync([], { frames: [total] }),
      inner: () => boxes.sync([], { frames: [total, square(2)], from: { '1:n': '0:a' } }),
      back: () => boxes.sync([], { frames: [total], ret: { to: '', from: 1, value: int(4) } }),
      again: () => boxes.sync([], { frames: [total, square(3)], from: { '1:n': '0:b' } }),
      backAgain: () => boxes.sync([], { frames: [total], ret: { to: '', from: 1, value: int(9) } }),
      done: () => boxes.sync([num('t', 13)], { frames: [], ret: { to: 't', from: 0 } }),
    },
    dispose: () => boxes.dispose(),
  };
});
