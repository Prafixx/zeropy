// How well the learner knows each objective, from their answers. A small
// form of Bayesian Knowledge Tracing (Corbett and Anderson, 1995): each
// objective has a chance that it is known. A right answer raises it, a
// wrong one lowers it, and each answer is also a chance to learn. Without
// practice the chance slowly falls back (forgetting), more slowly the more
// often the learner was right. It is an estimate, not a grade.

export interface KnowState {
  /** The chance (0 to 1) that the objective is known, right after the last answer. */
  p: number;
  /** Time of the last answer. */
  at: number;
  /** Number of answers. */
  n: number;
  /** Number of right answers. */
  right: number;
}

export type Level = 'new' | 'weak' | 'learning' | 'solid' | 'mastered';

/** What the learner sees for each level. */
export const LEVEL_NAME: Record<Level, string> = {
  new: 'Not started',
  weak: 'Not yet',
  learning: 'Learning',
  solid: 'Solid',
  mastered: 'Mastered',
};

/** The chance before any answer. */
const START = 0.2;
/** The chance to learn from one answer (also from a wrong one: feedback teaches). */
const LEARN = 0.12;
/** A known objective, answered wrong by mistake. */
const SLIP = 0.15;
const DAY = 24 * 60 * 60 * 1000;

/**
 * How likely a right answer is without knowing: high for multiple choice
 * (3 options), low where the answer must be produced (code, output, a table).
 */
export function guessOf(kind: string): number {
  return kind === 'mcq' ? 0.3 : 0.15;
}

/** The state after one more answer. */
export function update(prev: KnowState | undefined, correct: boolean, guess: number, now = Date.now()): KnowState {
  const p = prev ? effective(prev, now) : START;
  const posterior = correct ? (p * (1 - SLIP)) / (p * (1 - SLIP) + (1 - p) * guess) : (p * SLIP) / (p * SLIP + (1 - p) * (1 - guess));
  return {
    p: posterior + (1 - posterior) * LEARN,
    at: now,
    n: (prev?.n ?? 0) + 1,
    right: (prev?.right ?? 0) + (correct ? 1 : 0),
  };
}

/** The chance now: it falls back towards the start without practice. Half-life: 14 days, longer with each right answer. */
export function effective(state: KnowState, now = Date.now()): number {
  const days = Math.max(0, now - state.at) / DAY;
  const halfLife = Math.min(180, 14 * (1 + state.right));
  return START + (state.p - START) * 0.5 ** (days / halfLife);
}

export function levelOf(state: KnowState | undefined, now = Date.now()): Level {
  if (!state || state.n === 0) return 'new';
  const p = effective(state, now);
  if (p < 0.4) return 'weak';
  if (p < 0.7) return 'learning';
  if (p < 0.9) return 'solid';
  return 'mastered';
}

/** A first estimate from a review card that is older than this model: its Leitner box. */
export function fromBox(box: number, at: number): KnowState {
  const p = [0.35, 0.5, 0.65, 0.8, 0.9, 0.95][Math.min(box, 5)];
  return { p, at, n: 1, right: box > 0 ? 1 : 0 };
}
