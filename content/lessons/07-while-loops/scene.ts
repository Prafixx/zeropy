// Scene of the "while loops" hook: after the block, Python goes back up and
// asks the question again. False ends the loop.
import { defineScene, programRun } from '@/kit';

const code = ['count = 3', 'while count > 0:', '    print(count)', '    count = count - 1', 'print("Go!")'];
const yes = { 2: true };
const no = { 2: false };

export default defineScene(async (stage) => {
  const run = await programRun(stage);
  return {
    beats: {
      load: () => run.show({ code, line: null, out: [] }),
      start: () => run.show({ code, line: 1, out: [] }),
      ask: () => run.show({ code, line: 2, out: [], verdicts: yes }),
      print: () => run.show({ code, line: 3, out: ['3'], verdicts: yes }),
      change: () => run.show({ code, line: 4, out: ['3'], verdicts: yes }),
      back: () => run.show({ code, line: 2, out: ['3'], verdicts: yes }),
      rounds: () => run.show({ code, line: 3, out: ['3', '2', '1'], verdicts: yes }),
      stop: () => run.show({ code, line: 2, out: ['3', '2', '1'], verdicts: no }),
      after: () => run.show({ code, line: 5, out: ['3', '2', '1', 'Go!'], verdicts: no }),
    },
    dispose: () => run.dispose(),
  };
});
