// Scene of the "split a problem" hook: one function connects two small
// helpers. Each helper gets only what it needs and gives back one result.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar, CallFrame } from '@/kit';

const val = (name: string, repr: string, type: string): BoxVar => ({ name, repr, type });

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  const args = [val('item', "'Tea'", 'str'), val('price', '2.5', 'float'), val('count', '4', 'int')];
  const line = (more: BoxVar[] = []): CallFrame => ({ name: 'receipt', vars: [...args, ...more] });
  return {
    beats: {
      plan: () => boxes.sync([]),
      main: () => boxes.sync([], { frames: [line()] }),
      sub: () =>
        boxes.sync([], {
          frames: [line(), { name: 'cost', vars: [val('price', '2.5', 'float'), val('count', '4', 'int')] }],
          from: { '1:price': '0:price', '1:count': '0:count' },
        }),
      subBack: () => boxes.sync([], { frames: [line()], ret: { to: '', from: 1, value: { repr: '10.0', type: 'float' } } }),
      tax: () => boxes.sync([], { frames: [line(), { name: 'add_tax', vars: [val('amount', '10.0', 'float')] }] }),
      taxBack: () =>
        boxes.sync([], { frames: [line([val('total', '12.0', 'float')])], ret: { to: '0:total', from: 1 } }),
      done: () =>
        boxes.sync([val('text', "'Tea: 12.00'", 'str')], { frames: [], ret: { to: 'text', from: 0 } }),
    },
    dispose: () => boxes.dispose(),
  };
});
