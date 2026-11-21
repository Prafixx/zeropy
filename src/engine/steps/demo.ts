// Demo: the learner edits and runs code. A stepper plays the real run line
// by line and drives the same kind of actor as the hook. Experiments are
// checked like exercises.
import { finished, place, sleep, stamp } from '@/kit/motion';
import { createStage } from '@/kit/stage';
import type { Stage } from '@/kit/stage';
import { createVisual } from '@/kit/visuals';
import { MAX_ITEMS } from '@/kit/actors/variable-boxes';
import type { Feed, Pick } from '@/kit/actors/variable-boxes';
import type { TraceFrame, TraceVisual } from '@/kit/visuals';
import { runPython, warmPython } from '@/py/runner';
import type { CallFrame, DemoStep, RunResult, VarState } from '../types';
import { h, icon, md, mdInline } from '../ui';
import type { StepContext, StepView } from './context';
import { legend } from './hook';
import { createBoard } from './board';
import { createWorkbench } from './workbench';

const MAX_PLAYED_STEPS = 36;
const ASSIGN = /^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/;

/** If a line computes a variable from another one, name the source. */
function sourceOf(lineText: string, known: Set<string>): Record<string, string> | undefined {
  const match = ASSIGN.exec(lineText);
  if (!match) return undefined;
  const [, target, right] = match;
  const names = right.replace(/(["']).*?\1/g, '').match(/[A-Za-z_]\w*/g) ?? [];
  const source = names.find((n) => n !== target && known.has(n));
  return source ? { [target]: source } : undefined;
}

const SUBSCRIPT = /([A-Za-z_]\w*)\s*\[\s*([^\]]+?)\s*\]/d;
const STORE_ITEM = /^\s*[A-Za-z_]\w*\s*\[[^\]]*\]\s*=(?!=)/;

/** Hides what is inside quotes, but keeps every position in the line. */
function mask(text: string): string {
  return text.replace(/(["'])(.*?)\1/g, (_, quote: string, body: string) => quote + '_'.repeat(body.length) + quote);
}

/** The key as Python writes it: `"tea"` becomes `'tea'`. */
function keyRepr(raw: string, vars: VarState[]): string | undefined {
  const text = /^(["'])(.*)\1$/.exec(raw);
  if (text) return `'${text[2]}'`;
  if (/^-?\d+$/.test(raw)) return raw;
  return vars.find((v) => v.name === raw)?.repr;
}

/** If a line reads one place of a list or a dictionary, name it, the place and the target. */
function pickOf(lineText: string, vars: VarState[]): Pick | undefined {
  const code = mask(lineText);
  // `name[i] = value` changes a place. That is not a read.
  if (STORE_ITEM.test(code)) return undefined;
  const match = SUBSCRIPT.exec(code);
  const span = match?.indices?.[2];
  if (!match || !span) return undefined;
  const name = match[1];
  const [from, to] = span;
  const raw = lineText.slice(from, to).trim();
  const holder = vars.find((v) => v.name === name && v.items);
  if (!holder) return undefined;
  const size = holder.size ?? holder.items!.length;
  let index: number;
  if (holder.type === 'dict') {
    const key = keyRepr(raw, vars);
    index = key === undefined ? -1 : holder.items!.findIndex((item) => item.key === key);
  } else if (/^-?\d+$/.test(raw)) {
    index = Number(raw);
  } else {
    const variable = vars.find((v) => v.name === raw && v.type === 'int');
    if (!variable) return undefined;
    index = Number(variable.repr);
  }
  if (index < 0 && holder.type !== 'dict') index += size;
  if (index < 0 || index >= Math.min(size, MAX_ITEMS)) return undefined;
  const assign = ASSIGN.exec(code);
  const whole = assign && assign[2].replace(/\s/g, '') === match[0].replace(/\s/g, '');
  return { from: name, index, to: whole ? assign[1] : undefined };
}

const DEF = (name: string) => new RegExp(`^\\s*def\\s+${name}\\s*\\(([^)]*)\\)`);

/** The parameter names of a function, from its `def` line. */
function paramsOf(lines: string[], name: string): string[] {
  const pattern = DEF(name);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) return match[1].split(',').map((p) => p.split('=')[0].trim()).filter(Boolean);
  }
  return [];
}

/**
 * The arguments of a call of `name` on a line, as written. A line can call
 * the same function more than once: `nth` picks the call (it wraps around,
 * so a call on a line that runs again in a loop still finds its arguments).
 */
function argsOf(lineText: string, name: string, nth = 0): string[] {
  const code = mask(lineText);
  const matches = [...code.matchAll(new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, 'dg'))];
  const span = matches.length ? matches[nth % matches.length].indices?.[1] : undefined;
  if (!span) return [];
  const inside = lineText.slice(span[0], span[1]);
  return inside.trim() === '' ? [] : inside.split(',').map((a) => a.trim());
}

/** Two steps show the same call: same function, same call number. */
function sameCall(a: CallFrame, b: CallFrame): boolean {
  return a.name === b.name && (a.call ?? 0) === (b.call ?? 0);
}

const CONDITION = /^\s*(if|elif|while)\b.*:\s*(#.*)?$/;
const FOR = /^\s*for\s+([A-Za-z_]\w*)\s+in\b.*:\s*(#.*)?$/;
const FOR_LIST = /^\s*for\s+[A-Za-z_]\w*\s+in\s+([A-Za-z_]\w*)\s*:\s*(#.*)?$/;
const ELSE = /^\s*else\s*:/;
const EXCEPT = /^\s*except\b/;

function indent(text: string): number {
  return text.length - text.trimStart().length;
}

/** True when the next line that ran is inside the block of this line. */
function entersBlock(lines: string[], line: number, nextLine: number | undefined): boolean {
  if (nextLine === undefined) return false;
  return nextLine > line && indent(lines[nextLine - 1] ?? '') > indent(lines[line - 1] ?? '');
}

/** A condition was True when Python went into its block. */
function verdictOf(lines: string[], line: number, nextLine: number | undefined): boolean | undefined {
  if (!CONDITION.test(lines[line - 1] ?? '')) return undefined;
  return entersBlock(lines, line, nextLine);
}

/** Lines with code that never ran. Python reports no event for `else:`. */
function skippedLines(lines: string[], ran: Set<number>): number[] {
  const skipped: number[] = [];
  lines.forEach((text, i) => {
    const line = i + 1;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#') || ran.has(line)) return;
    if (ELSE.test(text)) {
      const next = lines.findIndex((t, j) => j > i && t.trim() !== '');
      if (next !== -1 && ran.has(next + 1)) return;
    }
    skipped.push(line);
  });
  return skipped;
}

function outLines(stdout: string): string[] {
  const text = stdout.replace(/\n$/, '');
  return text === '' ? [] : text.split('\n');
}

export interface DemoOptions {
  /** Called with the code after each edit (the playground saves it). */
  onEdit?: (code: string) => void;
}

export interface DemoView extends StepView {
  /** Puts new code in the editor. */
  setCode(code: string): void;
}

export function renderDemo(step: DemoStep, ctx: StepContext, options: DemoOptions = {}): DemoView {
  void warmPython().catch(() => undefined);
  const visualName = step.visual ?? 'variables';
  let stage: Stage | null = null;
  let visual: TraceVisual | null = null;
  let disposed = false;
  let token = 0;
  const ticked = step.experiments.map(() => false);

  const todo = step.experiments.map((experiment) =>
    h('li', { class: 'todo-item' }, h('span', { class: 'todo-box' }), h('span', null, mdInline(experiment.text))),
  );
  // The program picture has many small lines, so it gets a taller stage.
  const hasStage = visualName !== 'none' && visualName !== 'board';
  const size = visualName === 'output' ? 'stage-medium' : 'stage-short';
  const frame = h('div', { class: `stage-frame ${size}` }, h('div', { class: 'stage-loading' }, 'Loading the scene…'));
  const bench = createWorkbench({
    code: step.code,
    onRun,
    sealed: step.sealed,
    runLabel: step.sealed ? 'Play' : undefined,
    files: step.files,
    onEdit: () => options.onEdit?.(bench.getCode()),
  });
  // A Raspberry Pi program: the board plays the run; an input runs it again from that moment.
  const board =
    visualName === 'board'
      ? createBoard({ onInput: (_, at) => void onRun(bench.getCode(), at), onOutput: (text) => bench.setOutput(text) })
      : null;
  const hasTodo = step.experiments.length > 0;
  const el = h(
    'div',
    { class: 'split split-wide' },
    h(
      'div',
      { class: 'split-text', 'data-enter': true },
      md(step.intro),
      hasTodo ? h('h2', { class: 'todo-title' }, 'Try these') : null,
      hasTodo ? h('ul', { class: 'todo' }, ...todo) : null,
    ),
    h(
      'div',
      { class: 'split-visual', 'data-enter': true },
      hasStage ? frame : null,
      board?.el ?? null,
      visualName === 'variables' ? legend() : null,
      bench.el,
    ),
  );

  function updateNote(): void {
    if (!hasTodo) return;
    const count = ticked.filter(Boolean).length;
    ctx.dock.note(`${count} of ${ticked.length} experiments done`);
  }

  async function play(result: RunResult, code: string, mine: number): Promise<void> {
    if (!hasStage) {
      // No picture: show the result at once.
      bench.setOutput(result.stdout);
      bench.setFiles(result.files);
      bench.setWindow(result.gui);
      bench.showError(result.error);
      return;
    }
    const lines = code.split('\n');
    const at = (line: number | null, vars: VarState[], stdout: string, extra: Partial<TraceFrame> = {}): TraceFrame => ({
      code: lines,
      line,
      vars,
      out: outLines(stdout),
      ...extra,
    });
    bench.setOutput('');
    bench.showError(null);
    if (visual) await finished(visual.show(at(null, [], '')));
    const verdicts: Record<number, boolean> = {};
    const ran = new Set<number>();
    // For-loops: the values of the loop that runs now, and how many were taken.
    const taken = new Map<number, number>();
    let feed: Feed | undefined;
    // The state before each line: which calls ran, and the global names.
    let prevFrames: CallFrame[] = [];
    let prevVars: VarState[] = [];
    // How many calls of a function started from one line of one call.
    const callsFrom = new Map<string, number>();
    for (const [i, item] of result.steps.entries()) {
      if (mine !== token || disposed) return;
      ran.add(item.line);
      const frames = item.stack ?? [];
      // The calls that still run from before: same function, same call number.
      let keep = 0;
      while (keep < frames.length && keep < prevFrames.length && sameCall(frames[keep], prevFrames[keep])) keep++;
      // A line runs in the innermost call that ran before it (or at the top).
      const depth = prevFrames.length - 1;
      const ownVars = depth >= 0 ? (frames[depth] ?? prevFrames[depth]).vars : [];
      const own = new Set(ownVars.map((v) => v.name));
      const scopeVars = depth >= 0 ? [...ownVars, ...item.vars.filter((v) => !own.has(v.name))] : item.vars;
      // A name inside a call is `depth:name`, so the picture finds the right box.
      const idOf = (name: string) => (depth >= 0 && own.has(name) ? `${depth}:${name}` : name);
      const storeId = (name: string) => (depth >= 0 ? `${depth}:${name}` : name);
      // A long loop is not played to the end: after some steps, jump there.
      if (i >= MAX_PLAYED_STEPS) continue;
      bench.markLine(item.line);
      const isLast = i === result.steps.length - 1;
      const verdict = isLast && result.error ? undefined : verdictOf(lines, item.line, result.steps[i + 1]?.line);
      if (verdict !== undefined) verdicts[item.line] = verdict;
      const loop = FOR.exec(lines[item.line - 1] ?? '');
      const start = loop
        ? [...(result.feeds ?? [])].reverse().find((e) => e.line === item.line && e.at <= i + 1)
        : undefined;
      let pick: Pick | undefined;
      if (loop && start) {
        if (start.at === i + 1) taken.set(item.line, 0);
        const stopped = isLast && result.error;
        // A loop over a list that is drawn: its places are read in turn.
        // There is no separate row of waiting values, because the list is the row.
        const listName = FOR_LIST.exec(lines[item.line - 1] ?? '')?.[1];
        const holder = listName ? scopeVars.find((v) => v.name === listName && v.items) : undefined;
        // A set is drawn sorted, not in the order of the loop: it keeps the row.
        const drawn = Boolean(holder) && holder!.type !== 'set' && holder!.type !== 'frozenset';
        if (!stopped && entersBlock(lines, item.line, result.steps[i + 1]?.line)) {
          taken.set(item.line, (taken.get(item.line) ?? 0) + 1);
          const round = taken.get(item.line)!;
          if (drawn && round <= MAX_ITEMS) {
            feed = undefined;
            // A loop over a dictionary gets the keys, a loop over a list the values.
            pick = { from: idOf(listName!), index: round - 1, to: storeId(loop[1]), key: holder!.type === 'dict' };
          } else {
            feed = { name: storeId(loop[1]), values: start.values, taken: round };
          }
        } else {
          feed = undefined; // the row is empty: the loop is over
        }
      }
      const lineText = lines[item.line - 1] ?? '';
      let from: Record<string, string> | undefined;
      let ret: { to: string; from: number; value?: { repr: string; type: string } } | undefined;
      if (item.ret) {
        // A call ends: its value goes to the name that changed in the caller.
        const closed = prevFrames.length - 1;
        const caller = closed - 1;
        const after = caller >= 0 ? (frames[caller]?.vars ?? []) : item.vars;
        const before = caller >= 0 ? (prevFrames[caller]?.vars ?? []) : prevVars;
        const target = after.find(
          (v) => v.repr === item.ret!.repr && before.find((b) => b.name === v.name)?.repr !== v.repr,
        );
        ret = { to: target ? (caller >= 0 ? `${caller}:${target.name}` : target.name) : '', from: closed, value: item.ret };
      } else {
        const source = sourceOf(lineText, new Set(scopeVars.map((v) => v.name)));
        if (source) from = Object.fromEntries(Object.entries(source).map(([to, src]) => [storeId(to), idOf(src)]));
        const read = pickOf(lineText, scopeVars);
        if (read) read.to = read.to ? storeId(read.to) : undefined;
        if (read) read.from = idOf(read.from);
        pick ??= read;
      }
      // Calls that open: each argument that is a name sends its value to a
      // parameter. The arguments are on the line that made the call.
      let opening: Record<string, string> | undefined;
      for (let d = keep; d < frames.length; d++) {
        const frame = frames[d];
        const callerVars = d > 0 ? frames[d - 1].vars : [];
        const key = `${d > 0 ? (frames[d - 1].call ?? 0) : 0}:${frame.at}:${frame.name}`;
        const nth = callsFrom.get(key) ?? 0;
        callsFrom.set(key, nth + 1);
        const args = frame.at ? argsOf(lines[frame.at - 1] ?? '', frame.name, nth) : [];
        // Positional arguments go in order; `name=value` goes to that parameter.
        const keyword = new Map<string, string>();
        const positional: string[] = [];
        for (const arg of args) {
          const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(arg);
          if (kw) keyword.set(kw[1], kw[2].trim());
          else positional.push(arg);
        }
        paramsOf(lines, frame.name).forEach((param, k) => {
          const arg = keyword.get(param) ?? positional[k];
          if (!arg || !/^[A-Za-z_]\w*$/.test(arg)) return;
          const local = callerVars.find((v) => v.name === arg);
          const source = local ?? item.vars.find((v) => v.name === arg);
          if (!source || source.items) return;
          opening = { ...opening, [`${d}:${param}`]: local ? `${d - 1}:${arg}` : arg };
        });
      }
      prevFrames = frames;
      prevVars = item.vars;
      const out = result.stdout.slice(0, item.out);
      if (item.ret && frames.length > keep) {
        // A call ended and the next call started at once (for example
        // `f(a) + f(b)`): first the desk closes, then a new desk opens.
        const closing = { from, verdicts: { ...verdicts }, feed, pick, frames: frames.slice(0, keep), ret };
        if (visual) await finished(visual.show(at(item.line, item.vars, out, closing)));
        const extra = { from: opening, verdicts: { ...verdicts }, feed, frames };
        if (visual) await finished(visual.show(at(item.line, item.vars, out, extra)));
      } else {
        // An error that try catches: the next line that runs is an except line.
        const caught = !isLast && EXCEPT.test(lines[(result.steps[i + 1]?.line ?? 0) - 1] ?? '') && !EXCEPT.test(lineText);
        const extra = { from: { ...from, ...opening }, verdicts: { ...verdicts }, feed, pick, frames, ret, error: caught };
        if (visual) await finished(visual.show(at(item.line, item.vars, out, extra)));
      }
      bench.setOutput(result.stdout.slice(0, item.out));
      await sleep(260);
    }
    if (mine !== token || disposed) return;
    const errorLine = result.error?.line ?? null;
    bench.markLine(errorLine, 'error');
    visual?.show(
      at(errorLine, result.vars, result.stdout, {
        error: Boolean(result.error),
        verdicts,
        skipped: result.steps.length > 0 ? skippedLines(lines, ran) : [],
      }),
    );
    bench.setOutput(result.stdout);
    bench.setFiles(result.files);
    bench.setWindow(result.gui);
    bench.showError(result.error);
  }

  async function onRun(code: string, from?: number): Promise<void> {
    if (board && from === undefined) board.reset();
    const mine = ++token;
    frame.querySelector('.stage-hint')?.remove();
    const done = await bench.interact((stdin, seed) =>
      runPython({
        code,
        trace: hasStage,
        cases: [{ stdin, seed, files: step.files, web: step.web, gpio: board ? { events: board.inputs() } : undefined }],
        pytest: step.pytest,
        checks: step.experiments.map((e) => ({ expr: e.expr })),
      }),
    );
    if (!done || disposed) return;
    const { result } = done;
    if (board) {
      board.play(result.gpio, result.stdout, from);
      bench.showError(result.error);
    } else await play(result, code, mine);
    result.checks.forEach((check, i) => {
      if (!check.pass || ticked[i]) return;
      ticked[i] = true;
      todo[i].classList.add('is-done');
      const mark = icon('check', 16);
      todo[i].querySelector('.todo-box')!.append(mark);
      stamp(mark);
    });
    updateNote();
    ctx.done();
  }

  async function setup(): Promise<void> {
    if (visualName === 'none' || visualName === 'board') return;
    stage = await createStage(frame);
    if (!disposed) visual = await createVisual(visualName, stage);
    if (disposed) {
      visual?.dispose();
      stage.dispose();
      return;
    }
    frame.querySelector('.stage-loading')?.remove();
    if (visualName === 'output') visual?.show({ code: step.code.split('\n'), line: null, vars: [], out: [] });
    else {
      frame.append(h('div', { class: 'stage-hint' }, 'Press Run. Each line plays here.'));
      place(frame.lastElementChild!);
    }
  }

  ctx.dock.primary('Continue', false);
  updateNote();
  return {
    el,
    setCode: (code) => bench.setCode(code),
    entered: () => void setup(),
    dispose() {
      disposed = true;
      token += 1;
      bench.dispose();
      board?.dispose();
      visual?.dispose();
      stage?.dispose();
    },
  };
}
