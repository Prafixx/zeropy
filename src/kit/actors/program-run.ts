// Actor "program run".
// What it clarifies: a program is a list of instructions. Python runs them
// one at a time, from top to bottom. print() sends a value to the screen.
// An error stops the run at that line. A condition (if, elif) is a question
// with the answer True or False; lines that Python skips do not run.
import type { Timeline } from '../motion';
import type { Stage } from '../stage';

export interface RunFrame {
  /** All lines of the program. */
  code: string[];
  /** The line Python is on (1-based), or null when nothing runs. */
  line: number | null;
  /** Everything printed so far, one entry per line. */
  out: string[];
  /** The current line raised an error. */
  error?: boolean;
  /** Answers of the conditions asked so far, by line number (1-based). */
  verdicts?: Record<number, boolean>;
  /** Lines (1-based) that Python skipped. They are shown dim. */
  skipped?: number[];
}

export interface ProgramRun {
  /** Animates from the current picture to this moment of the run. */
  show(frame: RunFrame): Timeline;
  dispose(): void;
}

export const MAX_CODE_LINES = 8;
export const MAX_OUT_LINES = 6;

/** Lines the actor draws: no trailing blank lines, at most MAX_CODE_LINES. */
export function visibleCode(code: string[]): string[] {
  const lines = [...code];
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.slice(0, MAX_CODE_LINES);
}

/** True when `next` only adds lines to `prev` and still fits on the screen. */
export function onlyAppends(prev: string[], next: string[]): boolean {
  return next.length <= MAX_OUT_LINES && next.length >= prev.length && prev.every((line, i) => line === next[i]);
}

export function looksLikeNumber(text: string): boolean {
  return text.trim() !== '' && !Number.isNaN(Number(text));
}

export async function programRun(stage: Stage): Promise<ProgramRun> {
  if (stage.mode === '3d') {
    const { Run3D } = await import('./program-run-3d');
    return new Run3D(stage);
  }
  const { Run2D } = await import('./program-run-2d');
  return new Run2D(stage);
}
