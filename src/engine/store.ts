// Progress, spaced review (Leitner boxes), what the learner knows, and the
// lessons they chose to skip. Everything stays on the device.
import { fromBox, guessOf, levelOf, update } from './knowledge';
import type { KnowState, Level } from './knowledge';
import { allCards, findRef } from './registry';
import type { Card } from './registry';
import { shuffle } from './ui';

const KEY = 'zeropy:v1';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Wait time before the next review, by box. */
export const INTERVALS = [10 * MINUTE, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];

interface CardState {
  box: number;
  due: number;
  seen: number;
  lapses: number;
}

export interface LessonState {
  /** Highest step index the learner reached. */
  reached: number;
  done: boolean;
  doneAt?: number;
}

interface Data {
  lessons: Record<string, LessonState>;
  cards: Record<string, CardState>;
  /** Code the learner wrote in project steps, by lesson and step. */
  code: Record<string, string>;
  /**
   * Things that were hard, for the "My mistakes" page: "lesson:item" for a
   * question answered wrong, "lesson:step:id" for an exercise that needed
   * the solution or many runs. The value is the time of the mistake.
   */
  mistakes: Record<string, number>;
  /** When a task of mixed practice was last done: "lesson:item" or "lesson:step:id". */
  practiced: Record<string, number>;
  /** How well each objective is known: "lesson:O1" → estimate (see knowledge.ts). */
  knowledge: Record<string, KnowState>;
  /** Lessons the learner chose to skip, with the time. */
  skipped: Record<string, number>;
}

function load(): Data {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Data>;
    return {
      lessons: raw.lessons ?? {},
      cards: raw.cards ?? {},
      code: raw.code ?? {},
      mistakes: raw.mistakes ?? {},
      practiced: raw.practiced ?? {},
      knowledge: raw.knowledge ?? {},
      skipped: raw.skipped ?? {},
    };
  } catch {
    return empty();
  }
}

function empty(): Data {
  return { lessons: {}, cards: {}, code: {}, mistakes: {}, practiced: {}, knowledge: {}, skipped: {} };
}

let data = load();
seedKnowledge();

/**
 * Progress from before the knowledge model: the review cards that were
 * answered give a first estimate of their objectives (the best box counts).
 */
function seedKnowledge(): void {
  if (Object.keys(data.knowledge).length > 0 || Object.keys(data.cards).length === 0) return;
  for (const card of allCards()) {
    const state = data.cards[card.cardId];
    if (!state) continue;
    const key = `${card.lessonId}:${card.item.objective}`;
    const seed = fromBox(state.box, Date.now());
    if (!data.knowledge[key] || data.knowledge[key].p < seed.p) data.knowledge[key] = seed;
  }
  save();
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage can be blocked. Progress then lasts for this visit only.
  }
}

export function lessonState(id: string): LessonState {
  return data.lessons[id] ?? { reached: 0, done: false };
}

export function reachStep(id: string, index: number): void {
  const state = lessonState(id);
  data.lessons[id] = { ...state, reached: Math.max(state.reached, index) };
  save();
}

export function finishLesson(id: string): void {
  data.lessons[id] = { ...lessonState(id), done: true, doneAt: Date.now() };
  save();
}

/** Moves a card after an answer. Returns the time of its next review. */
export function gradeCard(cardId: string, correct: boolean): number {
  const prev = data.cards[cardId] ?? { box: 0, due: 0, seen: 0, lapses: 0 };
  const box = correct ? Math.min(prev.box + 1, INTERVALS.length - 1) : 0;
  const due = Date.now() + INTERVALS[box];
  data.cards[cardId] = { box, due, seen: prev.seen + 1, lapses: prev.lapses + (correct ? 0 : 1) };
  save();
  return due;
}

/** Cards the learner has seen before and that are due now. */
export function dueCards(now = Date.now()): Card[] {
  return allCards().filter((card) => {
    if (isSkipped(card.lessonId)) return false;
    const state = data.cards[card.cardId];
    return state !== undefined && state.due <= now;
  });
}

export function nextDue(): number | null {
  const times = Object.values(data.cards).map((c) => c.due);
  return times.length ? Math.min(...times) : null;
}

export function seenCardCount(): number {
  return Object.keys(data.cards).length;
}

/**
 * Cards for the review step of a lesson: due cards from earlier lessons
 * first (mixed), then this lesson's own cards for a first retrieval.
 */
export function pickReview(lessonId: string, lessonOrder: number, count: number): Card[] {
  const earlierDue = shuffle(dueCards().filter((c) => c.lessonOrder < lessonOrder));
  const own = shuffle(allCards().filter((c) => c.lessonId === lessonId));
  const ownFresh = own.filter((c) => !data.cards[c.cardId]);
  const ownSeen = own.filter((c) => data.cards[c.cardId]);
  const picked: Card[] = [];
  for (const card of [...earlierDue, ...ownFresh, ...ownSeen]) {
    if (picked.length >= count) break;
    if (!picked.some((p) => p.cardId === card.cardId)) picked.push(card);
  }
  return shuffle(picked);
}

/** Keeps the code of a project step. `key` is a step id, or id + ":ok" for code that passed. */
export function saveCode(lessonId: string, key: string, code: string): void {
  data.code[`${lessonId}:${key}`] = code;
  save();
}

export function loadCode(lessonId: string, key: string): string | undefined {
  return data.code[`${lessonId}:${key}`];
}

export function resetProgress(): void {
  data = empty();
  save();
}

/**
 * Remembers how an answer went. A wrong answer goes on the "My mistakes"
 * list; a right one (first try) takes it off again.
 */
export function noteAnswer(lessonId: string, ref: string, wrong: boolean): void {
  const found = findRef(lessonId, ref);
  if (found) {
    const objective = found.kind === 'item' ? found.item.objective : found.step.objective;
    noteEvidence(lessonId, objective, !wrong, found.kind === 'item' ? found.item.kind : 'exercise');
  }
  const key = `${lessonId}:${ref}`;
  if (wrong) data.mistakes[key] = Date.now();
  else if (key in data.mistakes) delete data.mistakes[key];
  else return;
  save();
}

export interface Mistake {
  lessonId: string;
  /** An item id, or "step:<id>" for an exercise. */
  ref: string;
  at: number;
}

/** The mistakes, newest first. */
export function mistakes(): Mistake[] {
  return Object.entries(data.mistakes)
    .map(([key, at]) => {
      const cut = key.indexOf(':');
      return { lessonId: key.slice(0, cut), ref: key.slice(cut + 1), at };
    })
    .filter((m) => !isSkipped(m.lessonId))
    .sort((a, b) => b.at - a.at);
}

/** Remembers that a task of mixed practice was done now. */
export function notePracticed(lessonId: string, ref: string): void {
  data.practiced[`${lessonId}:${ref}`] = Date.now();
  save();
}

/** When the task was last practiced (0: never). Old tasks come first. */
export function lastPracticed(lessonId: string, ref: string): number {
  return data.practiced[`${lessonId}:${ref}`] ?? 0;
}

// ---- What the learner knows ------------------------------------------------

/** One answer about an objective: right (on the first try, or easily) or not. */
export function noteEvidence(lessonId: string, objective: string, correct: boolean, kind: string): void {
  const key = `${lessonId}:${objective}`;
  data.knowledge[key] = update(data.knowledge[key], correct, guessOf(kind));
  save();
}

export function knowledgeOf(lessonId: string, objective: string): KnowState | undefined {
  return data.knowledge[`${lessonId}:${objective}`];
}

export function knowledgeLevel(lessonId: string, objective: string): Level {
  return levelOf(knowledgeOf(lessonId, objective));
}

// ---- Skipped lessons ----------------------------------------------------------

export function isSkipped(lessonId: string): boolean {
  return lessonId in data.skipped;
}

/** The learner does not want this lesson. It leaves "continue", review, mistakes and practice. */
export function skipLesson(lessonId: string): void {
  data.skipped[lessonId] = Date.now();
  save();
}

export function includeLesson(lessonId: string): void {
  delete data.skipped[lessonId];
  save();
}

export function describeWait(due: number, now = Date.now()): string {
  const ms = due - now;
  if (ms <= 0) return 'now';
  if (ms < 90 * MINUTE) return `in ${Math.max(1, Math.round(ms / MINUTE))} minutes`;
  if (ms < 36 * 60 * MINUTE) return 'tomorrow';
  return `in ${Math.round(ms / DAY)} days`;
}
