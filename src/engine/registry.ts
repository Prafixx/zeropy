// Finds lessons and scenes by file name. Adding a lesson folder is enough.
import type { SceneFactory } from '@/kit/stage';
import type { Course, Item, Lesson } from './types';
import courseData from '../../content/course.yaml';

const lessonFiles = import.meta.glob<Lesson>('../../content/lessons/*/lesson.yaml', {
  eager: true,
  import: 'default',
});
const sceneFiles = import.meta.glob<SceneFactory>('../../content/lessons/*/scene.ts', { import: 'default' });

export const course = courseData as Course;

interface Entry {
  lesson: Lesson;
  scene?: () => Promise<SceneFactory>;
}

const entries = new Map<string, Entry>();

for (const [path, lesson] of Object.entries(lessonFiles)) {
  // The questions of a demo get their own step right after it: first
  // play with the code, then explain how it works (Investigate, PRIMM).
  lesson.steps = lesson.steps.flatMap((step) =>
    step.type === 'demo' && step.investigate?.length
      ? [step, { type: 'investigate' as const, id: `${step.id}-how`, objective: step.objective, title: 'How does it work?', items: step.investigate }]
      : [step],
  );
  // Items inside steps inherit the objective of their step.
  // Project steps (carry) learn which step comes before them.
  let lastCarry: { id: string; solution: string } | undefined;
  for (const step of lesson.steps) {
    if (step.type === 'exercise' && step.carry) {
      step.starter ??= '';
      if (lastCarry) {
        step.prev = lastCarry.id;
        step.base = lastCarry.solution;
      }
      lastCarry = step;
    }
    if (step.type === 'predict') step.item.objective ??= step.objective;
    if (step.type === 'worked') step.check.objective ??= step.objective;
    if (step.type === 'quiz' || step.type === 'drill' || step.type === 'investigate') step.items.forEach((item) => (item.objective ??= step.objective));
  }
  const scenePath = path.replace('lesson.yaml', 'scene.ts');
  entries.set(lesson.id, { lesson, scene: sceneFiles[scenePath] });
}

export function lessons(): Lesson[] {
  return [...entries.values()].map((e) => e.lesson).sort((a, b) => a.order - b.order);
}

export function getLesson(id: string): Lesson | undefined {
  return entries.get(id)?.lesson;
}

export async function loadScene(lessonId: string): Promise<SceneFactory> {
  const load = entries.get(lessonId)?.scene;
  if (!load) throw new Error(`Lesson "${lessonId}" has no scene.ts`);
  return load();
}

export interface Card {
  cardId: string;
  lessonId: string;
  lessonOrder: number;
  item: Item;
}

/** Every review card of every lesson. */
export function allCards(): Card[] {
  return lessons().flatMap((lesson) =>
    lesson.review.map((item) => ({
      cardId: `${lesson.id}:${item.id}`,
      lessonId: lesson.id,
      lessonOrder: lesson.order,
      item,
    })),
  );
}

export type Found =
  | { kind: 'item'; lesson: Lesson; item: Item }
  | { kind: 'exercise'; lesson: Lesson; step: Lesson['steps'][number]; index: number };

/** Finds what a mistake points to: a question, or an exercise ("step:<id>"). */
export function findRef(lessonId: string, ref: string): Found | null {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;
  if (ref.startsWith('step:')) {
    const index = lesson.steps.findIndex((s) => s.id === ref.slice(5));
    return index === -1 ? null : { kind: 'exercise', lesson, step: lesson.steps[index], index };
  }
  for (const step of lesson.steps) {
    const item = itemsOf(step).find((i) => i.id === ref);
    if (item) return { kind: 'item', lesson, item };
  }
  const card = lesson.review.find((i) => i.id === ref);
  return card ? { kind: 'item', lesson, item: card } : null;
}

/** The questions inside a step. */
export function itemsOf(step: Lesson['steps'][number]): Item[] {
  if (step.type === 'predict') return [step.item];
  if (step.type === 'worked') return [step.check];
  if (step.type === 'quiz' || step.type === 'drill' || step.type === 'investigate') return step.items;
  return [];
}
