// Scene of the "exceptions" hook: an error inside try does not stop the
// program. Python jumps to the matching except block, skips the rest of the
// try block, and goes on after it.
import { defineScene, programRun } from '@/kit';

const code = [
  'text = "12x"',
  'try:',
  '    number = int(text)',
  '    print("You typed", number)',
  'except ValueError:',
  '    print("That is not a number.")',
  'print("The program goes on.")',
];

export default defineScene(async (stage) => {
  const run = await programRun(stage);
  const caught = ['That is not a number.'];
  return {
    beats: {
      load: () => run.show({ code, line: null, out: [] }),
      text: () => run.show({ code, line: 1, out: [] }),
      fail: () => run.show({ code, line: 3, out: [], error: true }),
      jump: () => run.show({ code, line: 6, out: caught, skipped: [4] }),
      on: () => run.show({ code, line: 7, out: [...caught, 'The program goes on.'], skipped: [4] }),
    },
    dispose: () => run.dispose(),
  };
});
