// Scene of the "first program" hook: Python reads a program line by line and
// print() sends each value to the screen.
import { defineScene, programRun } from '@/kit';

const code = ['print("Hello")', 'print(2 + 3)', 'print("Bye")'];

export default defineScene(async (stage) => {
  const run = await programRun(stage);
  return {
    beats: {
      load: () => run.show({ code, line: null, out: [] }),
      first: () => run.show({ code, line: 1, out: ['Hello'] }),
      second: () => run.show({ code, line: 2, out: ['Hello', '5'] }),
      third: () => run.show({ code, line: 3, out: ['Hello', '5', 'Bye'] }),
      end: () => run.show({ code, line: null, out: ['Hello', '5', 'Bye'] }),
    },
    dispose: () => run.dispose(),
  };
});
