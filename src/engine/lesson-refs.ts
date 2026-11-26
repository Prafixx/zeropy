// Lesson references by id. In any text of a lesson, `[[#git]]` becomes the
// number of the Python lesson with that id ("45"), so "as in lesson [[#git]]"
// stays right when lessons move. scripts/check-content.mjs fails on an
// unknown id, and on a reference to a later lesson.

export const LESSON_REF = /\[\[#([a-z0-9-]+)\]\]/g;

/** A copy-free walk: replaces the references in every string of `value`, in place. */
export function resolveRefs<T>(value: T, numberOf: (id: string) => number | undefined): T {
  const fix = (text: string): string => text.replace(LESSON_REF, (whole, id: string) => String(numberOf(id) ?? whole));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) v[i] = walk(v[i]);
      return v;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = walk(x);
      return v;
    }
    return v;
  };
  return walk(value) as T;
}

/** Every referenced id in a value, with how often. */
export function refsIn(value: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(LESSON_REF)) found.push(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return found;
}
