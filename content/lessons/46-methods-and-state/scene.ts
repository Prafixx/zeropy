// Scene of the "methods and state" hook: the methods of an object are the
// only way to change it, and they keep it valid. deposit() changes the
// balance; withdraw() checks first and refuses a change that would break
// the rule, so the balance stays as it was.
import { defineScene, variableBoxes } from '@/kit';
import type { BoxVar } from '@/kit';

const account = (name: string, balance: number): BoxVar => ({
  name,
  type: 'Account',
  repr: '<Account object>',
  object: true,
  items: [
    { key: 'owner', repr: "'Ana'", type: 'str' },
    { key: 'balance', repr: String(balance), type: 'int' },
  ],
  size: 2,
  ref: 'ana',
});
const amount = (value: number): BoxVar => ({ name: 'amount', type: 'int', repr: String(value) });
const call = (method: string, balance: number, value: number) => ({
  frames: [{ name: method, vars: [account('self', balance), amount(value)] }],
});

export default defineScene(async (stage) => {
  const boxes = await variableBoxes(stage);
  return {
    beats: {
      make: () => boxes.sync([account('account', 0)]),
      deposit: () => boxes.sync([account('account', 0)], call('deposit', 0, 50)),
      added: () => boxes.sync([account('account', 50)], call('deposit', 50, 50)),
      back: () => boxes.sync([account('account', 50)]),
      withdraw: () => boxes.sync([account('account', 50)], call('withdraw', 50, 100)),
      refused: () => boxes.sync([account('account', 50)]),
    },
    dispose: () => boxes.dispose(),
  };
});
