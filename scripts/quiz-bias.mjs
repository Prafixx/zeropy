// Quiz quality: for every multiple-choice question of the course, is the
// correct option the longest? A learner could then pass without reading.
// Reports, by part of the course: the questions, the share where the
// correct option is strictly the longest, where it is at least 1.5 times
// the longest wrong option, and where it is strictly the shortest. Also
// fails on questions without exactly one correct option.
// Usage: node scripts/quiz-bias.mjs [--list PART] [--max 40]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lessonsDir = join(root, 'content', 'lessons');
const course = load(readFileSync(join(root, 'content', 'course.yaml'), 'utf8'));
const pathNames = (course.paths ?? []).map((p) => p.short ?? p.title);
const args = process.argv.slice(2);
const listPart = args.includes('--list') ? args[args.indexOf('--list') + 1] : null;
const listMax = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : 40;

const partOf = (order) => (order < 100 ? 'Python' : pathNames[Math.floor(order / 100) - 1]);
const label = (order) => (order < 100 ? String(order) : `${partOf(order)} ${order % 100}`);

// Every mcq item, wherever it sits: quizzes, drills, investigate, worked checks, review cards.
function* mcqs(value, where) {
  if (Array.isArray(value)) {
    for (const v of value) yield* mcqs(v, where);
  } else if (value && typeof value === 'object') {
    if (value.kind === 'mcq' && Array.isArray(value.options)) yield { item: value, where };
    for (const [k, v] of Object.entries(value)) if (k !== 'options') yield* mcqs(v, where);
  }
}

const stats = new Map();
const listed = [];
let problems = 0;
for (const folder of readdirSync(lessonsDir)) {
  let lesson;
  try {
    lesson = load(readFileSync(join(lessonsDir, folder, 'lesson.yaml'), 'utf8'));
  } catch {
    continue;
  }
  const part = partOf(lesson.order);
  const s = stats.get(part) ?? { n: 0, longest: 0, far: 0, shortest: 0 };
  const sources = [
    ...(lesson.steps ?? []).map((st, i) => [st, `${label(lesson.order)}.${i + 1}`]),
    ...(lesson.review ?? []).map((st, i) => [st, `${label(lesson.order)}.R${i + 1}`]),
    ...(lesson.extra ?? []).map((st, i) => [st, `${label(lesson.order)}.E${i + 1}`]),
  ];
  for (const [src, ref] of sources) {
    for (const { item } of mcqs(src, ref)) {
      const right = item.options.filter((o) => o.correct);
      if (right.length !== 1) {
        problems += 1;
        console.error(`  FAIL ${ref} ${item.id}: ${right.length} correct options`);
        continue;
      }
      const len = (o) => String(o.text).length;
      const r = len(right[0]);
      const wrong = item.options.filter((o) => !o.correct).map(len);
      if (!wrong.length) continue;
      s.n += 1;
      const isLongest = r > Math.max(...wrong);
      if (isLongest) s.longest += 1;
      if (r >= 1.5 * Math.max(...wrong)) s.far += 1;
      if (r < Math.min(...wrong)) s.shortest += 1;
      if (listPart && part === listPart && isLongest) listed.push(`${ref} ${item.id} (${r} vs ${Math.max(...wrong)})`);
    }
  }
  stats.set(part, s);
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const all = { n: 0, longest: 0, far: 0, shortest: 0 };
console.log('part          questions  correct longest  >= 1.5x  correct shortest');
for (const [part, s] of stats) {
  for (const k of Object.keys(all)) all[k] += s[k];
  console.log(`${part.padEnd(14)}${String(s.n).padStart(9)}  ${pct(s.longest, s.n).padStart(15)}  ${pct(s.far, s.n).padStart(7)}  ${pct(s.shortest, s.n).padStart(16)}`);
}
console.log(`${'all'.padEnd(14)}${String(all.n).padStart(9)}  ${pct(all.longest, all.n).padStart(15)}  ${pct(all.far, all.n).padStart(7)}  ${pct(all.shortest, all.n).padStart(16)}`);
if (listPart) console.log(`\n${listPart}, correct strictly longest (${listed.length}):\n` + listed.slice(0, listMax).join('\n'));
if (problems) process.exit(1);
