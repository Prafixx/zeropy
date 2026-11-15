// The rules of a debugger, over a real trace of the harness. Used by the
// debugger step in the page and by check-content, so both agree on where
// the program stops and what a variable holds there.
//
// A trace step holds the state AFTER its line ran. A debugger that stops on
// a line shows the state BEFORE the line runs: that is the state after the
// step before it.
import type { CallFrame, TraceStep, VarState } from './types';

/** One place where the debugger can stop: before a line runs. */
export interface Pause {
  line: number;
  /** How many function calls run (0: the top of the program). */
  depth: number;
  globals: VarState[];
  /** Function calls, from the outside in. The last one is the current call. */
  frames: CallFrame[];
  /** Length of the output so far. */
  out: number;
}

export type Move = 'continue' | 'over' | 'into' | 'out';

export function pausesOf(steps: TraceStep[]): Pause[] {
  const pauses: Pause[] = [];
  steps.forEach((step, i) => {
    // A step where a function returns is not a line of its own.
    if (step.ret) return;
    const before = i > 0 ? steps[i - 1] : undefined;
    const frames = before?.stack ?? [];
    pauses.push({ line: step.line, depth: frames.length, globals: before?.vars ?? [], frames, out: before?.out ?? 0 });
  });
  return pauses;
}

/**
 * Where the program stops next. `current` is -1 before the start. Returns
 * an index of `pauses`, or `pauses.length` when the program runs to its end.
 * Like VS Code, a breakpoint stops every move, also a step over a call.
 */
export function nextPause(pauses: Pause[], current: number, move: Move, breakpoints: Set<number>): number {
  const start = current + 1;
  if (move === 'into') return Math.min(start, pauses.length);
  const depth = current >= 0 ? pauses[current].depth : 0;
  for (let q = start; q < pauses.length; q += 1) {
    const p = pauses[q];
    if (breakpoints.has(p.line)) return q;
    if (move === 'over' && p.depth <= depth) return q;
    if (move === 'out' && p.depth < depth) return q;
  }
  return pauses.length;
}

/** The value of a name at a pause: in the current call first, then the program. */
export function valueAt(pause: Pause, name: string): string | undefined {
  const local = pause.frames.at(-1)?.vars.find((v) => v.name === name);
  return (local ?? pause.globals.find((v) => v.name === name))?.repr;
}

/** The pause of the `hit`-th time (from 1) that the program stops on `line`. */
export function pauseAt(pauses: Pause[], line: number, hit = 1): Pause | undefined {
  return pauses.filter((p) => p.line === line)[hit - 1];
}

/** True when an answer means the same value as Python's text of it. */
export function sameValue(answer: string, repr: string): boolean {
  const a = answer.trim();
  if (!a) return false;
  const squeeze = (text: string) => text.replace(/\s+/g, '').replace(/"/g, "'");
  if (squeeze(a) === squeeze(repr)) return true;
  // A text may be typed without its quotes.
  const text = /^(['"])(.*)\1$/s.exec(repr);
  if (text && a === text[2]) return true;
  // 5 and 5.0 are the same number.
  const n = Number(a);
  const m = Number(repr);
  return a !== '' && repr !== '' && !Number.isNaN(n) && !Number.isNaN(m) && n === m;
}
