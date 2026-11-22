// Build-time lesson validation. No imports with runtime code: this file is
// loaded by vite.config.ts and by scripts/check-content.mjs (Node).

type Rec = Record<string, unknown>;

const STEP_TYPES = ['hook', 'theory', 'predict', 'demo', 'worked', 'exercise', 'local', 'debugger', 'terminal', 'quiz', 'drill', 'review'];
const PRACTICE = ['predict', 'demo', 'exercise', 'local', 'debugger', 'terminal', 'quiz', 'drill', 'review'];

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkItem(item: unknown, where: string, objectives: Set<string>, out: string[]): void {
  if (!isRec(item)) {
    out.push(`${where}: item must be a mapping`);
    return;
  }
  if (!text(item.id)) out.push(`${where}: item needs an id`);
  if (item.objective !== undefined && !objectives.has(String(item.objective))) {
    out.push(`${where}: unknown objective "${String(item.objective)}"`);
  }
  if (item.kind === 'mcq') {
    const options = Array.isArray(item.options) ? item.options : [];
    if (!text(item.prompt)) out.push(`${where}: mcq needs a prompt`);
    if (options.length < 2) out.push(`${where}: mcq needs at least 2 options`);
    if (options.filter((o) => isRec(o) && o.correct === true).length !== 1) {
      out.push(`${where}: mcq needs exactly one correct option`);
    }
    options.forEach((o, i) => {
      if (!isRec(o) || !text(o.text) || !text(o.why)) {
        out.push(`${where}: option ${i + 1} needs "text" and "why"`);
      }
    });
  } else if (item.kind === 'diagnose') {
    if (!text(item.code)) out.push(`${where}: diagnose needs code`);
    if (!text(item.explain)) out.push(`${where}: diagnose needs an explanation`);
    if (item.mode !== 'read' && item.mode !== 'predict') out.push(`${where}: diagnose mode must be "read" or "predict"`);
    if (item.fix !== undefined) {
      const fix = Array.isArray(item.fix) ? item.fix : [];
      if (fix.filter((o) => isRec(o) && o.correct === true).length !== 1) {
        out.push(`${where}: diagnose fix needs exactly one correct option`);
      }
      fix.forEach((o, i) => {
        if (!isRec(o) || !text(o.text) || !text(o.why)) out.push(`${where}: fix option ${i + 1} needs "text" and "why"`);
      });
    }
  } else if (item.kind === 'predict') {
    if (!text(item.code)) out.push(`${where}: predict needs code`);
    if (!text(item.explain)) out.push(`${where}: predict needs an explanation`);
  } else if (item.kind === 'order') {
    const lines = text(item.code) ? item.code.replace(/\n+$/, '').split('\n') : [];
    if (lines.length < 3) out.push(`${where}: order needs code with at least 3 lines`);
    if (lines.some((line) => line.trim() === '')) out.push(`${where}: order code must have no empty lines`);
    if (new Set(lines).size < 2) out.push(`${where}: order needs lines that differ`);
    if (!text(item.explain)) out.push(`${where}: order needs an explanation`);
    if (item.stdin !== undefined && (!Array.isArray(item.stdin) || !item.stdin.every(Array.isArray))) {
      out.push(`${where}: order stdin must be a list of answer lists`);
    }
  } else if (item.kind === 'blanks') {
    const code = text(item.code) ? item.code : '';
    const blanks = [...code.matchAll(/\[\?(.*?)\?\]/g)];
    if (blanks.length === 0) out.push(`${where}: blanks needs code with at least one [?answer?]`);
    if (blanks.length > 6) out.push(`${where}: blanks has more than 6 blanks`);
    if (blanks.some((m) => m[1].trim() === '')) out.push(`${where}: every blank needs an answer on one line`);
    if (!text(item.explain)) out.push(`${where}: blanks needs an explanation`);
    if (item.stdin !== undefined && (!Array.isArray(item.stdin) || !item.stdin.every(Array.isArray))) {
      out.push(`${where}: blanks stdin must be a list of answer lists`);
    }
    const said = Array.isArray(item.misconceptions) ? item.misconceptions : [];
    said.forEach((m, i) => {
      if (!isRec(m) || typeof m.blank !== 'number' || m.blank < 1 || m.blank > blanks.length || !text(m.answer) || !text(m.say)) {
        out.push(`${where}: misconception ${i + 1} needs blank (1 to ${blanks.length}), answer and say`);
      }
    });
  } else if (item.kind === 'trace') {
    if (!text(item.code)) out.push(`${where}: trace needs code`);
    if (!text(item.explain)) out.push(`${where}: trace needs an explanation`);
    const names = Array.isArray(item.names) ? item.names : [];
    if (names.length === 0 || names.length > 4 || !names.every((n) => typeof n === 'string' && /^[A-Za-z_]\w*$/.test(n))) {
      out.push(`${where}: trace needs 1 to 4 variable names`);
    }
    if (item.stdin !== undefined && (!Array.isArray(item.stdin) || !item.stdin.every((a) => typeof a === 'string'))) {
      out.push(`${where}: trace stdin must be a list of answers`);
    }
  } else if (item.kind === 'spot') {
    const lines = text(item.code) ? item.code.replace(/\n+$/, '').split('\n').length : 0;
    if (!text(item.prompt)) out.push(`${where}: spot needs a prompt`);
    if (lines < 2) out.push(`${where}: spot needs code with at least 2 lines`);
    if (typeof item.line !== 'number' || item.line < 1 || item.line > lines) out.push(`${where}: spot line must be a line of the code`);
    if (!text(item.explain)) out.push(`${where}: spot needs an explanation`);
    if (item.wrong !== undefined) {
      const wrong = Array.isArray(item.wrong) ? item.wrong : [];
      wrong.forEach((w, i) => {
        if (!isRec(w) || typeof w.line !== 'number' || w.line === item.line || !text(w.say)) {
          out.push(`${where}: spot wrong ${i + 1} needs another "line" and "say"`);
        }
      });
    }
  } else {
    out.push(`${where}: item kind must be "mcq", "predict", "diagnose", "order", "trace", "spot" or "blanks"`);
  }
}

/** Returns a list of problems. An empty list means the lesson is valid. */
export function validateLesson(data: unknown): string[] {
  const out: string[] = [];
  if (!isRec(data)) return ['lesson must be a mapping'];
  for (const key of ['id', 'title', 'summary']) {
    if (!text(data[key])) out.push(`missing "${key}"`);
  }
  if (typeof data.order !== 'number') out.push('missing numeric "order"');

  const objectives = new Set<string>();
  if (!Array.isArray(data.objectives) || data.objectives.length === 0) {
    out.push('a lesson needs objectives');
  } else {
    for (const o of data.objectives) {
      if (!isRec(o) || !text(o.id) || !text(o.text)) out.push('each objective needs "id" and "text"');
      else objectives.add(o.id as string);
    }
  }

  const steps = Array.isArray(data.steps) ? data.steps : [];
  if (steps.length === 0) out.push('a lesson needs steps');
  const ids = new Set<string>();
  const covered = new Set<string>();
  let practice = 0;

  steps.forEach((step, i) => {
    const where = `step ${i + 1}`;
    if (!isRec(step)) {
      out.push(`${where}: must be a mapping`);
      return;
    }
    const type = String(step.type);
    if (!STEP_TYPES.includes(type)) out.push(`${where}: unknown type "${type}"`);
    if (!text(step.id)) out.push(`${where}: missing id`);
    else if (ids.has(step.id)) out.push(`${where}: duplicate id "${step.id}"`);
    else ids.add(step.id);
    if (!text(step.title)) out.push(`${where}: missing title`);
    if (!text(step.objective) || !objectives.has(step.objective)) {
      out.push(`${where}: every step must name one of the lesson objectives`);
    } else if (PRACTICE.includes(type) || type === 'worked') {
      covered.add(step.objective);
    }
    if (PRACTICE.includes(type)) practice += 1;

    if (type === 'hook') {
      if (!text(step.code) || !Array.isArray(step.beats) || step.beats.length === 0) {
        out.push(`${where}: hook needs code and beats`);
      }
    }
    if (type === 'theory' && !text(step.body)) out.push(`${where}: theory needs a body`);
    if (type === 'predict') checkItem(step.item, where, objectives, out);
    if (type === 'demo') {
      if (!text(step.code)) out.push(`${where}: demo needs code`);
      if (step.visual !== undefined && !['variables', 'output', 'none', 'board'].includes(String(step.visual))) {
        out.push(`${where}: unknown visual "${String(step.visual)}"`);
      }
      if (!Array.isArray(step.experiments) || step.experiments.length === 0) {
        out.push(`${where}: demo needs experiments (things to try)`);
      }
      if (step.investigate !== undefined) {
        const items = Array.isArray(step.investigate) ? step.investigate : [];
        if (items.length === 0) out.push(`${where}: investigate needs items`);
        items.forEach((item, j) => {
          checkItem(item, `${where} investigate ${j + 1}`, objectives, out);
          if (isRec(item) && text(item.objective)) covered.add(item.objective);
        });
      }
    }
    if (type === 'worked') {
      if (!Array.isArray(step.lines) || step.lines.length === 0) out.push(`${where}: worked needs lines`);
      else if (step.lines.some((l) => isRec(l) && l.goal !== undefined) && !(isRec(step.lines[0]) && text(step.lines[0].goal))) {
        out.push(`${where}: when lines have goals, the first line needs one too`);
      }
      checkItem(step.check, `${where} check`, objectives, out);
    }
    if (type === 'exercise') checkExercise(step, where, out);
    if (type === 'local') {
      if (!text(step.prompt)) out.push(`${where}: local needs a prompt`);
      if (!text(step.task) || !/^[a-z][a-z0-9-]*$/.test(step.task)) out.push(`${where}: local needs a task name`);
      const checks = Array.isArray(step.checks) ? step.checks : [];
      if (checks.length === 0) out.push(`${where}: local needs checks`);
      checks.forEach((c, j) => {
        if (!isRec(c) || !text(c.expr) || !text(c.pass) || !text(c.hint)) {
          out.push(`${where}: check ${j + 1} needs "expr", "pass" and "hint"`);
        }
      });
      if (!isRec(step.example)) out.push(`${where}: local needs an example report`);
      if (!Array.isArray(step.hints) || step.hints.length < 2) out.push(`${where}: local needs at least 2 hints`);
    }
    if (type === 'terminal') {
      if (!text(step.prompt)) out.push(`${where}: terminal needs a prompt`);
      const checks = Array.isArray(step.checks) ? step.checks : [];
      if (checks.length === 0) out.push(`${where}: terminal needs checks`);
      checks.forEach((c, j) => {
        if (!isRec(c) || !text(c.expr) || !text(c.pass) || !text(c.hint)) {
          out.push(`${where}: check ${j + 1} needs "expr", "pass" and "hint"`);
        }
      });
      // A line may be empty: the answer Enter to a question (like adduser's details). The first may not.
      if (!Array.isArray(step.solution) || step.solution.length === 0 || !text(step.solution[0]) || !step.solution.every((l) => typeof l === 'string')) {
        out.push(`${where}: terminal needs a solution: a list of commands`);
      }
      if (step.start !== undefined && !isRec(step.start)) out.push(`${where}: terminal start must be a mapping`);
      if (!Array.isArray(step.hints) || step.hints.length < 2) out.push(`${where}: terminal needs at least 2 hints`);
    }
    if (type === 'debugger') {
      if (!text(step.prompt)) out.push(`${where}: debugger needs a prompt`);
      if (!text(step.code)) out.push(`${where}: debugger needs code`);
      const tasks = Array.isArray(step.tasks) ? step.tasks : [];
      if (tasks.length === 0) out.push(`${where}: debugger needs tasks`);
      tasks.forEach((t, j) => {
        if (!isRec(t) || !text(t.do)) out.push(`${where}: task ${j + 1} needs "do"`);
        else if (t.name !== undefined && typeof t.line !== 'number') out.push(`${where}: task ${j + 1} asks for a value, so it needs a line`);
        else if (t.name === undefined && t.frame === undefined && typeof t.line !== 'number') out.push(`${where}: task ${j + 1} needs a name, a frame or a line`);
      });
      if (!Array.isArray(step.hints) || step.hints.length < 2) out.push(`${where}: debugger needs at least 2 hints`);
    }
    if (type === 'quiz' || type === 'drill') {
      const items = Array.isArray(step.items) ? step.items : [];
      if (items.length === 0) out.push(`${where}: ${type} needs items`);
      items.forEach((item, j) => {
        checkItem(item, `${where} item ${j + 1}`, objectives, out);
        if (isRec(item) && text(item.objective)) covered.add(item.objective);
      });
    }
  });

  for (const id of objectives) {
    if (!covered.has(id)) out.push(`objective ${id} is never practiced or checked`);
  }
  if (steps.length > 0 && practice / steps.length < 0.6) {
    out.push('less than 60% of the steps are practice');
  }

  const review = Array.isArray(data.review) ? data.review : [];
  if (review.length < 3) out.push('a lesson needs at least 3 review cards');
  review.forEach((item, j) => {
    checkItem(item, `review card ${j + 1}`, objectives, out);
    if (isRec(item) && !text(item.objective)) out.push(`review card ${j + 1}: missing objective`);
  });

  // "Practice more": extra exercises, not shown in the lesson itself.
  if (data.extra !== undefined && !Array.isArray(data.extra)) out.push('"extra" must be a list of exercises');
  const extra = Array.isArray(data.extra) ? data.extra : [];
  extra.forEach((step, j) => {
    const where = `extra ${j + 1}`;
    if (!isRec(step)) {
      out.push(`${where}: must be a mapping`);
      return;
    }
    if (step.type !== 'exercise') out.push(`${where}: an extra must be an exercise (type: exercise)`);
    if (!text(step.id)) out.push(`${where}: missing id`);
    else if (ids.has(step.id)) out.push(`${where}: duplicate id "${step.id}"`);
    else ids.add(step.id);
    if (!text(step.title)) out.push(`${where}: missing title`);
    if (!text(step.objective) || !objectives.has(step.objective)) out.push(`${where}: must name one of the lesson objectives`);
    if (!['completion', 'debug', 'independent'].includes(String(step.fade))) out.push(`${where}: fade must be completion, debug or independent`);
    if (step.carry !== undefined) out.push(`${where}: an extra stands alone (no carry)`);
    checkExercise(step, where, out);
  });
  return out;
}

function checkExercise(step: Record<string, unknown>, where: string, out: string[]): void {
  if (!text(step.prompt)) out.push(`${where}: exercise needs a prompt`);
  // A project step can start from the code of the step before it.
  if (typeof step.starter !== 'string' && step.carry !== true) out.push(`${where}: exercise needs starter code`);
  if (!text(step.solution)) out.push(`${where}: exercise needs a solution`);
  const checks = Array.isArray(step.checks) ? step.checks : [];
  if (checks.length === 0) out.push(`${where}: exercise needs checks`);
  checks.forEach((c, j) => {
    if (!isRec(c) || !text(c.expr) || !text(c.pass) || !text(c.hint)) {
      out.push(`${where}: check ${j + 1} needs "expr", "pass" and "hint"`);
    }
  });
  if (!Array.isArray(step.hints) || step.hints.length < 2) {
    out.push(`${where}: exercise needs at least 2 hints`);
  }
}
