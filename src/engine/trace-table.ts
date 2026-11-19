// The answer key of a trace table, from the real run. No imports with
// runtime code: scripts/check-content.mjs (Node) uses it too.
import type { TraceStep } from './types';

/** One row of a trace table: a line that ran and what it changed or printed. */
export interface TraceRow {
  line: number;
  /** New values, by name: only the names that this line changed. */
  values: Record<string, { repr: string; type: string }>;
  /** What the line printed, or null. */
  prints: string | null;
}

/**
 * The rows of a trace table, from the real run: one for each line that
 * changes one of `names` or prints something. Shared with check-content.
 *
 * A trace step holds the state after its line. A global name that changes
 * during a call (`y = double(x)`) belongs to the line of the program that
 * made the call, not to the `return` inside the function. What a function
 * prints belongs to its own line.
 */
export function traceRows(steps: TraceStep[], stdout: string, names: string[]): TraceRow[] {
  const rows: TraceRow[] = [];
  const last: Record<string, string | undefined> = {};
  let printed = 0;
  let outer = steps[0]?.line ?? 1;
  steps.forEach((step, i) => {
    // The calls that were running when this line ran: the state after the step before.
    const inCall = i > 0 && (steps[i - 1].stack?.length ?? 0) > 0;
    if (!inCall) outer = step.line;
    const values: TraceRow['values'] = {};
    for (const name of names) {
      const v = step.vars.find((x) => x.name === name);
      if (v && v.repr !== last[name]) values[name] = { repr: v.repr, type: v.type };
      last[name] = v?.repr;
    }
    const text = stdout.slice(printed, step.out).replace(/\n+$/, '');
    printed = Math.max(printed, step.out);
    const changed = Object.keys(values).length > 0;
    if (text && changed && step.line !== outer) {
      rows.push({ line: step.line, values: {}, prints: text });
      rows.push({ line: outer, values, prints: null });
    } else if (changed || text) {
      rows.push({ line: changed ? outer : step.line, values, prints: text || null });
    }
  });
  return rows;
}

/** A value as Python writes it, made comparable: no spaces outside quotes, one kind of quote. */
function canon(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (const ch of text.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch === '"' ? "'" : ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += "'";
    } else if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

/** The parts of `{a, b}` or `{k: v, ...}` at the top level, sorted: the order of a set or a dict does not count. */
function partsOf(text: string): string | null {
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let part = '';
  for (const ch of text.slice(1, -1)) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'") quote = ch;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(part);
      part = '';
      continue;
    }
    part += ch;
  }
  if (part) parts.push(part);
  return parts.sort().join(',');
}

/** Is the learner's value the real one? `'Ana'` and `Ana` both count for text. */
export function sameValue(guess: string, real: { repr: string; type: string }): boolean {
  const g = guess.trim();
  if (g === '') return false;
  const a = canon(g);
  const b = canon(real.repr);
  if (a === b) return true;
  if ((real.type === 'dict' || real.type === 'set') && partsOf(a) !== null && partsOf(a) === partsOf(b)) return true;
  return real.type === 'str' && g === real.repr.slice(1, -1);
}

export function samePrint(guess: string, real: string): boolean {
  const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
  return tidy(guess) === tidy(real);
}
