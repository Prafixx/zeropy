// The learner's other files of a project (models.py, storage.py), next to
// main.py. Used by the registry and by scripts/check-content.mjs, so the app
// and the content check see the same files.
import type { ExerciseStep } from './types';

type AnyStep = { type: string };

/**
 * Fills in the files of each exercise. In the project steps (carry) of a
 * lesson, a file of the step before that a step does not list comes along
 * unchanged, and a listed file without a starter starts as the step before
 * left it. `baseModules` gets the files of the step before, for "Load a
 * working version of the last step".
 */
export function inheritModules(steps: AnyStep[]): void {
  let before: Record<string, string> | undefined;
  for (const raw of steps) {
    if (raw.type !== 'exercise') continue;
    const step = raw as ExerciseStep;
    const listed = step.modules ?? {};
    if (!step.carry) {
      for (const file of Object.values(listed)) file.starter ??= '';
      continue;
    }
    const all: NonNullable<ExerciseStep['modules']> = {};
    const names = [...Object.keys(before ?? {}), ...Object.keys(listed).filter((name) => !(name in (before ?? {})))];
    for (const name of names) {
      const own = listed[name];
      const old = before?.[name];
      all[name] = own ? { starter: own.starter ?? old ?? '', solution: own.solution } : { starter: old ?? '', solution: old ?? '' };
    }
    if (names.length) {
      step.modules = all;
      if (before) step.baseModules = before;
    }
    before = names.length ? Object.fromEntries(names.map((name) => [name, all[name].solution])) : before;
  }
}

/** The texts of the step's other files: their starters, or their solutions. */
export function moduleTexts(step: ExerciseStep, which: 'starter' | 'solution'): Record<string, string> {
  return Object.fromEntries(Object.entries(step.modules ?? {}).map(([name, file]) => [name, (which === 'starter' ? file.starter : file.solution) ?? '']));
}
