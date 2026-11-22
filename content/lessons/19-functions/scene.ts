// Scene of the "define and call" hook: a call opens a desk with its own
// boxes; the argument is copied in; return sends a value back and the desk
// closes.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const num = (name: string, value: number): BoxVar => ({ name, type: 'int', repr: String(value) });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const w = num('w', 3);
  const open = [num('width', 3), num('height', 4)];
  return {
    beats: {
      empty: () => boxes.sync([]),
      define: () => boxes.sync([]),
      global: () => boxes.sync([w]),
      call: () => boxes.sync([w], { frames: [{ name: 'area', vars: open }], from: { '0:width': 'w' } }),
      inside: () =>
        boxes.sync([w], {
          frames: [{ name: 'area', vars: [...open, num('result', 12)] }],
          from: { '0:result': '0:width' },
        }),
      back: () => boxes.sync([w, num('a', 12)], { frames: [], ret: { to: 'a', from: 0 } }),
    },
    dispose: () => boxes.dispose(),
  };
});
