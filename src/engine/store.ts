// Progress and spaced review (Leitner boxes). Everything stays on the device.
import { allCards } from './registry';
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
}

function load(): Data {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Data>;
    return { lessons: raw.lessons ?? {}, cards: raw.cards ?? {}, code: raw.code ?? {}, mistakes: raw.mistakes ?? {} };
  } catch {
    return { lessons: {}, cards: {}, code: {}, mistakes: {} };
  }
}

let data = load();

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
  data = { lessons: {}, cards: {}, code: {}, mistakes: {} };
  save();
}

/**
 * Remembers how an answer went. A wrong answer goes on the "My mistakes"
 * list; a right one (first try) takes it off again.
 */
export function noteAnswer(lessonId: string, ref: string, wrong: boolean): void {
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
    .sort((a, b) => b.at - a.at);
}

export function describeWait(due: number, now = Date.now()): string {
  const ms = due - now;
  if (ms <= 0) return 'now';
  if (ms < 90 * MINUTE) return `in ${Math.max(1, Math.round(ms / MINUTE))} minutes`;
  if (ms < 36 * 60 * MINUTE) return 'tomorrow';
  return `in ${Math.round(ms / DAY)} days`;
}
