// When a path (Linux, Raspberry Pi, ...) opens. A path needs some Python
// lessons: each must be done, and its topics not weak (from "My knowledge").
// The learner can always open a path by hand: their choice, not the rule.
import { effective } from './knowledge';
import { course, getLesson, pathOf } from './registry';
import { isSkipped, knowledgeOf, lessonState, pathOpenedByHand } from './store';
import type { CoursePath, Lesson } from './types';

/** Below this mean chance, the topics of a lesson are not ready for a path. */
const READY = 0.5;

/** A needed lesson is ready: done, and its practiced topics are not weak on average. */
export function lessonReady(lesson: Lesson): boolean {
  if (!lessonState(lesson.id).done) return false;
  const known = lesson.objectives.map((o) => knowledgeOf(lesson.id, o.id)).filter((k) => k !== undefined);
  if (known.length === 0) return true;
  return known.reduce((sum, k) => sum + effective(k), 0) / known.length >= READY;
}

export interface PathStatus {
  open: boolean;
  /** Opened with "Open it anyway". */
  byHand: boolean;
  needs: { lesson: Lesson; ready: boolean }[];
}

export function pathStatus(path: CoursePath): PathStatus {
  const needs = path.needs
    .map((id) => getLesson(id))
    .filter((l): l is Lesson => Boolean(l))
    .map((lesson) => ({ lesson, ready: lessonReady(lesson) }));
  const byHand = pathOpenedByHand(path.id);
  return { open: byHand || needs.every((n) => n.ready), byHand, needs };
}

/** Can the learner take this lesson now? Not skipped, and its path (if any) is open. */
export function lessonAvailable(lesson: Lesson): boolean {
  if (isSkipped(lesson.id)) return false;
  const path = pathOf(lesson.id);
  return !path || pathStatus(path).open;
}

export function paths(): CoursePath[] {
  return course.paths ?? [];
}
