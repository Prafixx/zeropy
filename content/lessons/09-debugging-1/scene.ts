// Scene of the "reading error messages" hook: Python runs down the lines,
// stops at the first line it cannot run, and the rest never happens.
import { defineScene, programRun } from '@/kit';

const code = ['total = 25', 'people = 5', 'print("Start")', 'share = total / person', 'print(share)'];
const out = ['Start'];

export default defineScene(async (stage) => {
  const run = await programRun(stage);
  return {
    beats: {
      load: () => run.show({ code, line: null, out: [] }),
      run: () => run.show({ code, line: 3, out }),
      stop: () => run.show({ code, line: 4, out, error: true }),
      rest: () => run.show({ code, line: 4, out, error: true, skipped: [5] }),
      report: () => run.show({ code, line: 4, out, error: true, skipped: [5] }),
    },
    dispose: () => run.dispose(),
  };
});
