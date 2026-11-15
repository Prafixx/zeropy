// Pictures that a real program run can drive, line by line. The demo step
// picks one by name; each wraps a kit actor.
import { programRun } from './actors/program-run';
import { variableBoxes } from './actors/variable-boxes';
import type { BoxVar, CallFrame, Feed, Pick } from './actors/variable-boxes';
import type { Timeline } from './motion';
import type { Stage } from './stage';

export interface TraceFrame {
  code: string[];
  line: number | null;
  vars: BoxVar[];
  out: string[];
  /** Variable computed from another variable on this line. */
  from?: Record<string, string>;
  error?: boolean;
  /** Answers of conditions (if, elif, while) by line number. */
  verdicts?: Record<number, boolean>;
  /** Lines that did not run. */
  skipped?: number[];
  /** A for-loop is running: its values and how many were taken. */
  feed?: Feed;
  /** A value is read from one place of a list. */
  pick?: Pick;
  /** Function calls that run after this line, from the outside in. */
  frames?: CallFrame[];
  /** A call ended on this line: where its value goes. */
  ret?: { to: string; from: number; value?: { repr: string; type: string } };
}

export interface TraceVisual {
  /** Show the value color legend next to this visual. */
  legend: boolean;
  show(frame: TraceFrame): Timeline;
  dispose(): void;
}

export type VisualName = 'variables' | 'output';

export async function createVisual(name: VisualName, stage: Stage): Promise<TraceVisual> {
  if (name === 'output') {
    const run = await programRun(stage);
    return {
      legend: false,
      show: (frame) =>
        run.show({
          code: frame.code,
          line: frame.line,
          out: frame.out,
          error: frame.error,
          verdicts: frame.verdicts,
          skipped: frame.skipped,
        }),
      dispose: () => run.dispose(),
    };
  }
  const boxes = await variableBoxes(stage);
  return {
    legend: true,
    show: (frame) =>
      boxes.sync(frame.vars, { from: frame.from, feed: frame.feed, pick: frame.pick, frames: frame.frames, ret: frame.ret }),
    dispose: () => boxes.dispose(),
  };
}
