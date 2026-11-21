// Content QA: validates every lesson and runs every exercise through the real
// harness (Pyodide in Node). Solutions must pass all checks; starters must not.
// Also runs every predict item, so no item can crash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { loadPyodide } from 'pyodide';
import { pauseAt, pausesOf, valueAt } from '../src/engine/debug-session.ts';
import { parseReport, SEAL_SALT } from '../src/engine/local-report.ts';
import { traceRows } from '../src/engine/trace-table.ts';
import { validateLesson } from '../src/engine/validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lessonsDir = join(root, 'content', 'lessons');
const pyodide = await loadPyodide();
pyodide.runPython(readFileSync(join(root, 'src', 'py', 'harness.py'), 'utf8'));
pyodide.runPython(readFileSync(join(root, 'src', 'py', 'shell.py'), 'utf8'));
const shellFn = pyodide.globals.get('shell');
const shell = (request) => JSON.parse(shellFn(JSON.stringify(request)));
const run = pyodide.globals.get('run');
const call = (request) => JSON.parse(run(JSON.stringify(request)));

let problems = 0;
// Tasks of check.py that some lesson uses.
const localTasks = new Map();
const fail = (message) => {
  problems += 1;
  console.error(`  FAIL ${message}`);
};

// Every lesson must be on the course map, at the place of its number, or
// the home page shows it as locked.
// A lesson of a path has the order 100 × (place of the path) + its place.
const courseMap = load(readFileSync(join(root, 'content', 'course.yaml'), 'utf8'));
const orders = new Map();
courseMap.modules.flatMap((m) => m.lessons).forEach((l, i) => orders.set(l.id, i + 1));
(courseMap.paths ?? []).forEach((path, p) => {
  if (!path.id || !path.short || !Array.isArray(path.needs)) fail(`path ${p + 1}: needs id, short and needs`);
  for (const need of path.needs ?? []) if (!orders.has(need)) fail(`path ${path.id}: needs "${need}", which is not a Python lesson`);
  path.modules.flatMap((m) => m.lessons).forEach((l, i) => orders.set(l.id, 100 * (p + 1) + i + 1));
});
console.log('course.yaml');
readdirSync(lessonsDir).forEach((folder) => {
  const lesson = load(readFileSync(join(lessonsDir, folder, 'lesson.yaml'), 'utf8'));
  const want = orders.get(lesson.id);
  if (want === undefined) fail(`${folder}: the id "${lesson.id}" is not in course.yaml`);
  else if (want !== lesson.order) fail(`${folder}: order ${lesson.order}, but its place in course.yaml gives ${want}`);
});

for (const folder of readdirSync(lessonsDir)) {
  const lesson = load(readFileSync(join(lessonsDir, folder, 'lesson.yaml'), 'utf8'));
  console.log(`${folder}`);
  for (const problem of validateLesson(lesson)) fail(problem);

  const items = [...(lesson.review ?? [])];
  let lastCarry = null;
  for (const step of lesson.steps ?? []) {
    if (step.type === 'predict') items.push(step.item);
    if (step.type === 'quiz' || step.type === 'drill') items.push(...step.items);
    if (step.type === 'demo') {
      items.push(...(step.investigate ?? []));
      const result = call({ code: step.code, trace: true, pytest: step.pytest, checks: step.experiments, cases: [{ files: step.files, web: step.web }] });
      // A demo that asks for input cannot finish here; that is expected.
      if (result.error && !result.error.needsInput) fail(`${step.id}: demo code raises ${result.error.type}`);
      if (result.steps.length === 0) fail(`${step.id}: demo produced no trace`);
    }
    if (step.type === 'debugger') {
      // Every task must be possible on the real run, and each value must exist.
      const result = call({ code: step.code, trace: true, cases: [{ stdin: step.stdin ?? [] }] });
      if (result.steps.length >= 400) fail(`${step.id}: the trace is too long for the debugger (400 steps)`);
      const pauses = pausesOf(result.steps);
      const answers = [];
      step.tasks.forEach((task, j) => {
        if (task.name !== undefined) {
          const pause = pauseAt(pauses, task.line, task.hit ?? 1);
          const value = pause ? valueAt(pause, task.name) : undefined;
          if (value === undefined) fail(`${step.id}: task ${j + 1}: no value of ${task.name} at stop ${task.hit ?? 1} on line ${task.line}`);
          else answers.push(`${task.name}=${value}`);
        } else if (task.frame !== undefined) {
          if (!pauses.some((p) => p.frames.at(-1)?.name === task.frame)) fail(`${step.id}: task ${j + 1}: the program never runs inside ${task.frame}()`);
        } else if (!pauseAt(pauses, task.line, task.hit ?? 1)) {
          fail(`${step.id}: task ${j + 1}: the program never stops on line ${task.line} (stop ${task.hit ?? 1})`);
        }
      });
      console.log(`  ok   ${step.id} (debugger, ${pauses.length} stops; answers: ${answers.join(', ') || 'none'})`);
      continue;
    }
    if (step.type === 'terminal') {
      // The model commands must work and pass every check; the start alone must not.
      const abs = (p) => (p.startsWith('/') ? p : `/home/pi/${p.replace(/^~\//, '')}`);
      const start = step.start ?? {};
      let state = {
        files: Object.fromEntries(Object.entries(start.files ?? {}).map(([p, t]) => [abs(p), t])),
        dirs: (start.dirs ?? []).map(abs),
        modes: Object.fromEntries(Object.entries(start.modes ?? {}).map(([p, m]) => [abs(p), m])),
        cwd: start.cwd ? abs(start.cwd) : '/home/pi',
        history: [],
        packages: start.packages ?? [],
      };
      const exprs = step.checks.map((c) => c.expr);
      const first = shell({ state, checks: exprs });
      if (first.checks.every(Boolean)) fail(`${step.id}: the start already passes every check`);
      let last = first;
      for (const line of step.solution) {
        last = shell({ state, line, checks: exprs });
        if (last.code === 127 || /syntax error/.test(last.out)) fail(`${step.id}: model command "${line}" fails: ${last.out.trim()}`);
        state = last.state;
      }
      last.checks.forEach((ok, i) => {
        if (!ok) fail(`${step.id}: the model commands fail check ${i + 1} (${exprs[i]})`);
      });
      console.log(`  ok   ${step.id} (terminal, ${step.solution.length} commands, ${exprs.length} checks)`);
      continue;
    }
    if (step.type === 'local') {
      // The checks must pass on the example report and fail on an empty one.
      const checks = step.checks.map((c) => ({ expr: c.expr }));
      const withReport = (fields) => [{ setup: `report = ${JSON.stringify(fields)}\nsealed = True` }];
      const good = call({ code: '', cases: withReport({ task: step.task, check: String(step.needs ?? 1), ...step.example }), checks });
      good.checks.forEach((check, i) => {
        if (!check.pass) fail(`${step.id}: example report fails check ${i + 1} (${step.checks[i].expr})`);
      });
      const empty = call({ code: '', cases: withReport({ task: step.task, check: String(step.needs ?? 1) }), checks });
      if (empty.checks.every((check) => check.pass)) fail(`${step.id}: an empty report already passes`);
      localTasks.set(step.task, Math.max(localTasks.get(step.task) ?? 1, step.needs ?? 1));
      console.log(`  ok   ${step.id} (local task ${step.task}, ${checks.length} checks)`);
      continue;
    }
    if (step.type !== 'exercise') continue;
    // In the browser the learner types the answers for the first case.
    // Here it borrows the answers of the first case that has some.
    const sample = (step.cases ?? []).find((c) => c.stdin)?.stdin;
    // A case with answers can also fix a variable (`set`), for example a
    // secret number. A case without answers borrows both.
    const sampleSet = (step.cases ?? []).find((c) => c.stdin)?.set;
    const cases = (step.cases ?? [{}]).map((c) => ({
      ...c,
      setup: c.setup ?? step.given,
      files: c.files ?? step.files,
      web: c.web ?? step.web,
      stdin: c.stdin ?? sample,
      set: c.set ?? (c.stdin ? undefined : sampleSet),
    }));
    const solved = call({ code: step.solution, cases, pytest: step.pytest, checks: step.checks });
    solved.checks.forEach((check, i) => {
      if (!check.pass) fail(`${step.id}: solution fails check ${i + 1} (${step.checks[i].expr})`);
    });
    // A project step starts from the solution of the step before it. That
    // code must not pass yet: every step has to ask for something new.
    const starter = step.carry ? (lastCarry?.solution ?? step.starter ?? '') : step.starter;
    if (step.carry) lastCarry = step;
    const start = call({ code: starter, cases, pytest: step.pytest, checks: step.checks });
    if (start.checks.every((check) => check.pass)) fail(`${step.id}: starter already passes`);
    console.log(`  ok   ${step.id} (${step.checks.length} checks, ${cases.length} cases)`);
  }
  for (const item of items) {
    if (item.kind === 'trace') {
      // The table comes from the real run: it must be short, with values
      // that are shown in full (the harness cuts long lists and texts).
      const result = call({ code: item.code, trace: true, cases: [{ stdin: item.stdin ?? [] }] });
      if (result.error) {
        fail(`${item.id}: trace code raises ${result.error.type}`);
        continue;
      }
      const rows = traceRows(result.steps, result.stdout, item.names);
      if (rows.length < 2 || rows.length > 14) fail(`${item.id}: the table has ${rows.length} rows (2 to 14)`);
      for (const name of item.names) {
        if (!rows.some((r) => r.values[name])) fail(`${item.id}: ${name} never gets a value (is it a global name?)`);
      }
      const cells = rows.flatMap((r) => [...Object.values(r.values).map((v) => v.repr), ...(r.prints === null ? [] : [r.prints])]);
      if (cells.some((c) => c.includes('...'))) fail(`${item.id}: a value is too long and is cut ("...")`);
      if (rows.some((r) => r.prints?.includes('\n'))) fail(`${item.id}: one line prints more than one line`);
      console.log(`  ok   ${item.id} (trace, ${rows.length} rows, ${cells.length} boxes: ${rows.map((r) => `${r.line}:${Object.entries(r.values).map(([n, v]) => `${n}=${v.repr}`).join(',')}${r.prints === null ? '' : `>${r.prints}`}`).join(' ')})`);
      continue;
    }
    if (item.kind === 'spot') {
      // The code is only read, not run (it may need files or the web): it must compile.
      const result = call({ code: `compile(${JSON.stringify(item.code)}, 'main.py', 'exec')`, cases: [{}] });
      if (result.error) fail(`${item.id}: spot code does not compile (${result.error.type})`);
      else console.log(`  ok   ${item.id} (spot, line ${item.line}: ${item.code.split('\n')[item.line - 1].trim()})`);
      continue;
    }
    if (item.kind === 'order') {
      // The program must run, and the order must matter: the lines read
      // backwards may not give the same result (or there is nothing to learn).
      const outcome = (code, stdin) => {
        const result = call({ code, cases: [{ stdin }] });
        const values = result.vars.map((v) => `${v.name}=${v.repr}`).sort().join('\n');
        return { error: result.error, key: `${result.stdout.trim()}\n--\n${values}` };
      };
      const source = item.code.replace(/\n+$/, '');
      const backwards = source.split('\n').reverse().join('\n');
      let ok = true;
      let differs = false;
      for (const stdin of item.stdin ?? [[]]) {
        const good = outcome(source, stdin);
        if (good.error) {
          fail(`${item.id}: order code raises ${good.error.type}`);
          ok = false;
          break;
        }
        const bad = outcome(backwards, stdin);
        if (bad.error || bad.key !== good.key) differs = true;
      }
      if (ok && !differs) fail(`${item.id}: the lines backwards give the same result, so the order does not matter`);
      else if (ok) console.log(`  ok   ${item.id} (order of ${source.split('\n').length} lines)`);
      continue;
    }
    if (item.kind === 'diagnose') {
      // The program must stop with a real error on a known line.
      const result = call({ code: item.code, cases: [{ files: item.files, web: item.web }] });
      const error = result.error;
      if (!error || error.needsInput || error.type === 'Timeout' || error.line === null) {
        fail(`${item.id}: diagnose code must stop with an error on a line`);
      } else console.log(`  ok   ${item.id} stops with ${error.type} on line ${error.line}`);
      continue;
    }
    if (item.kind !== 'predict') continue;
    const result = call({ code: item.code, cases: [{ files: item.files, web: item.web }] });
    if (result.error) fail(`${item.id}: predict code raises ${result.error.type}`);
    else console.log(`  ok   ${item.id} prints ${JSON.stringify(result.stdout.trim())}`);
  }
}

// check.py and the page must agree on the block and its seal. This needs a
// Python on this computer; without one, the test is skipped.
const python = ['python3', 'python'].find((cmd) => {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (localTasks.size > 0) {
  console.log('check.py');
  if (!python) console.log('  skip no Python on this computer');
  for (const [task, needs] of python ? localTasks : []) {
    const dir = mkdtempSync(join(tmpdir(), 'zp-check-'));
    writeFileSync(join(dir, 'hello.py'), 'print("Hello")\n');
    try {
      const out = execFileSync(python, [join(root, 'public', 'check.py'), task], { cwd: dir, encoding: 'utf8' });
      const parsed = parseReport(out);
      if (!parsed.ok) fail(`check.py ${task}: no block (${parsed.reason})`);
      else {
        const { report } = parsed;
        const seal = createHash('sha256').update(`${SEAL_SALT}\n${report.body.join('\n')}`, 'utf8').digest('hex').slice(0, 10);
        if (seal !== report.seal) fail(`check.py ${task}: the seal does not match`);
        else if (report.fields.task !== task) fail(`check.py ${task}: wrong task in the block`);
        else if (Number(report.fields.check) < needs) fail(`check.py ${task}: a lesson needs check ${needs}, check.py is ${report.fields.check}`);
        else console.log(`  ok   ${task}: ${Object.keys(report.fields).length} fields, seal ${seal}`);
      }
    } catch (error) {
      fail(`check.py ${task}: ${error.message.split('\n')[0]}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (problems > 0) {
  console.error(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log('\nAll content checks passed.');
