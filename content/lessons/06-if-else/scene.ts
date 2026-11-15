// Scene of the "if, elif, else" hook: each condition is a question with a
// True or False badge. One block runs; the skipped lines go dim.
import { defineScene, programRun } from '@/kit';

const code = [
  'score = 72',
  'if score >= 90:',
  '    print("gold")',
  'elif score >= 50:',
  '    print("silver")',
  'else:',
  '    print("try again")',
];

export default defineScene(async (stage) => {
  const run = await programRun(stage);
  return {
    beats: {
      load: () => run.show({ code, line: null, out: [] }),
      value: () => run.show({ code, line: 1, out: [] }),
      first: () => run.show({ code, line: 2, out: [], verdicts: { 2: false }, skipped: [3] }),
      second: () => run.show({ code, line: 4, out: [], verdicts: { 2: false, 4: true }, skipped: [3] }),
      block: () => run.show({ code, line: 5, out: ['silver'], verdicts: { 2: false, 4: true }, skipped: [3] }),
      end: () => run.show({ code, line: null, out: ['silver'], verdicts: { 2: false, 4: true }, skipped: [3, 6, 7] }),
    },
    dispose: () => run.dispose(),
  };
});
