// Terminal step: a pretend Linux (src/py/shell.py) in the page. The learner
// types commands; the folder picture next to it changes with each one. The
// checks look at the result (the files, the folders, the commands that
// ran), never at one exact command. Nothing here touches the real computer.
import { confetti, place, shake, stamp } from '@/kit/motion';
import { runShell, warmPython } from '@/py/runner';
import { noteAnswer } from '../store';
import type { ShellResult, ShellState, TerminalStep } from '../types';
import { button, codeBlock, h, icon, md, mdInline, panel } from '../ui';
import type { StepContext, StepView } from './context';

const HOME = '/home/pi';

/** A path for the screen: ~ for the home directory. */
function shown(path: string): string {
  return path === HOME ? '~' : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

/** The start state, with paths under the home directory made absolute (as shell.py keeps them). */
function startState(step: TerminalStep): ShellState {
  const abs = (p: string) => (p.startsWith('/') ? p : `${HOME}/${p.replace(/^~\//, '')}`);
  const start = step.start ?? {};
  const files = Object.fromEntries(Object.entries(start.files ?? {}).map(([p, t]) => [abs(p), t]));
  // The folders that hold the files exist too (shell.py makes them the same way).
  const dirs = new Set((start.dirs ?? []).map(abs));
  for (const p of [...Object.keys(files), ...dirs]) {
    for (let d = p.slice(0, p.lastIndexOf('/')); d.length > HOME.length; d = d.slice(0, d.lastIndexOf('/'))) dirs.add(d);
  }
  return {
    files,
    dirs: [...dirs].sort(),
    modes: Object.fromEntries(Object.entries(start.modes ?? {}).map(([p, m]) => [abs(p), m])),
    cwd: start.cwd ? abs(start.cwd) : HOME,
    history: [],
    packages: start.packages ?? [],
  };
}

interface Terminal {
  el: HTMLElement;
  focus(): void;
  dispose(): void;
}

/**
 * The terminal and the folder picture. `onResult` gets each result after
 * the screen shows it.
 */
export function createTerminal(initial: ShellState, checks: string[], onResult: (r: ShellResult, line: string) => void): Terminal {
  let state = initial;
  let prompt = `pi@raspberrypi:${shown(state.cwd ?? HOME)} $`;
  let busy = false;
  let disposed = false;
  const typed: string[] = [];
  let back = 0;

  const screen = h('div', { class: 'term-screen', role: 'log', 'aria-live': 'polite', 'aria-label': 'Terminal output' });
  const promptEl = h('span', { class: 'term-prompt' }, prompt);
  const input = h('input', {
    class: 'term-input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-label': 'Type a command, then press Enter',
  });
  const line = h('label', { class: 'term-line' }, promptEl, input);
  const editorName = h('span', { class: 'term-editor-name' });
  const editorText = h('textarea', { class: 'term-editor-text', spellcheck: 'false', 'aria-label': 'The text of the file' });
  let editorPath = '';
  const save = button('Save and exit (Ctrl+X)', { kind: 'primary', small: true, onClick: () => void closeEditor(true) });
  const cancel = button('Exit without saving', { kind: 'ghost', small: true, onClick: () => void closeEditor(false) });
  const editor = h(
    'div',
    { class: 'term-editor', hidden: true },
    h('div', { class: 'term-editor-bar' }, h('span', null, 'GNU nano'), editorName),
    editorText,
    h('div', { class: 'term-editor-actions' }, save, cancel),
  );
  const tree = h('div', { class: 'term-tree', 'aria-label': 'Your files and folders' });
  const frame = h('div', { class: 'term-frame' }, h('div', { class: 'term-bar' }, h('i'), h('i'), h('i'), h('span', null, 'Terminal: pi@raspberrypi')), screen, line, editor);
  const el = h('div', { class: 'term' }, frame, h('div', { class: 'term-side' }, h('h2', { class: 'term-side-title' }, icon('file', 16), 'Your files'), tree));

  function print(text: string, cls = ''): void {
    if (!text) return;
    const block = h('pre', { class: `term-out ${cls}` }, text.replace(/\n$/, ''));
    screen.append(block);
    screen.scrollTop = screen.scrollHeight;
  }

  /** The home directory as a tree. The working directory is marked. */
  function drawTree(changed: Set<string>): void {
    const files = Object.keys(state.files ?? {});
    const dirs = new Set([HOME, ...(state.dirs ?? [])]);
    const all = [...dirs, ...files].filter((p) => p === HOME || p.startsWith(`${HOME}/`));
    const kids = (d: string) =>
      all
        .filter((p) => p !== d && p.startsWith(`${d}/`) && !p.slice(d.length + 1).includes('/'))
        .sort((a, b) => Number(dirs.has(b)) - Number(dirs.has(a)) || a.localeCompare(b));
    const node = (p: string): HTMLElement => {
      const isDir = dirs.has(p);
      const name = p === HOME ? '~ (home)' : p.slice(p.lastIndexOf('/') + 1);
      const here = p === state.cwd;
      const row = h(
        'span',
        { class: `term-node${isDir ? ' is-dir' : ''}${here ? ' is-here' : ''}${changed.has(p) ? ' is-new' : ''}` },
        isDir ? '▸ ' : '',
        `${name}${isDir && p !== HOME ? '/' : ''}`,
        here ? h('small', null, ' ← you are here') : null,
      );
      const children = isDir ? kids(p) : [];
      return h('li', null, row, children.length ? h('ul', null, ...children.map(node)) : null);
    };
    tree.replaceChildren(h('ul', null, node(HOME)));
    const fresh = tree.querySelectorAll('.is-new');
    if (fresh.length) place(fresh);
  }

  function apply(result: ShellResult): void {
    const before = new Set([...(state.dirs ?? []), ...Object.keys(state.files ?? {})]);
    state = result.state;
    const after = [...(state.dirs ?? []), ...Object.keys(state.files ?? {})];
    drawTree(new Set(after.filter((p) => !before.has(p))));
    if (result.prompt) {
      prompt = result.prompt;
      promptEl.textContent = prompt;
    }
  }

  async function submit(): Promise<void> {
    const text = input.value;
    if (busy || disposed) return;
    print(`${prompt} ${text}`, 'is-cmd');
    input.value = '';
    if (!text.trim()) return;
    typed.push(text);
    back = 0;
    busy = true;
    line.classList.add('is-busy');
    const result = await runShell({ state, line: text, checks });
    busy = false;
    line.classList.remove('is-busy');
    if (disposed) return;
    if (result.clear) screen.replaceChildren();
    print(result.out, result.code === 0 ? '' : 'is-error');
    apply(result);
    if (result.editor) openEditor(result.editor);
    onResult(result, text);
  }

  function openEditor(file: { path: string; name: string; text: string }): void {
    editorPath = file.path;
    editorName.textContent = file.name;
    editorText.value = file.text;
    line.hidden = true;
    editor.hidden = false;
    place(editor);
    editorText.focus();
  }

  async function closeEditor(keep: boolean): Promise<void> {
    if (busy) return;
    editor.hidden = true;
    line.hidden = false;
    if (keep) {
      busy = true;
      const result = await runShell({ state, write: { path: editorPath, text: editorText.value }, checks });
      busy = false;
      if (disposed) return;
      print(`[ Wrote ${editorText.value.split('\n').length} lines to ${editorName.textContent} ]`, 'is-note');
      apply(result);
      onResult(result, `nano ${editorName.textContent}`);
    }
    input.focus();
  }

  /** Tab: completes the name of a file or a directory of the working directory. */
  function complete(): void {
    const words = input.value.split(' ');
    const last = words.at(-1) ?? '';
    const slash = last.lastIndexOf('/');
    const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
    const start = last.slice(slash + 1);
    const base = dirPart.startsWith('/') ? dirPart.replace(/\/$/, '') || '/' : dirPart.startsWith('~/') ? `${HOME}/${dirPart.slice(2).replace(/\/$/, '')}`.replace(/\/$/, '') : [state.cwd, dirPart.replace(/\/$/, '')].filter(Boolean).join('/');
    const folder = base.replace(/\/+$/, '') || '/';
    const dirs = new Set([HOME, ...(state.dirs ?? [])]);
    const names = [...dirs, ...Object.keys(state.files ?? {})]
      .filter((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/'))
      .map((p) => p.slice(folder.length + 1) + (dirs.has(p) ? '/' : ''))
      .filter((n) => n.startsWith(start));
    if (names.length === 1) {
      words[words.length - 1] = dirPart + names[0];
      input.value = words.join(' ');
    } else if (names.length > 1) {
      print(`${prompt} ${input.value}\n${names.join('  ')}`, 'is-note');
    }
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!typed.length) return;
      event.preventDefault();
      back = Math.max(0, Math.min(typed.length, back + (event.key === 'ArrowUp' ? 1 : -1)));
      input.value = back === 0 ? '' : typed[typed.length - back];
    } else if (event.key === 'Tab') {
      event.preventDefault();
      complete();
    } else if (event.key === 'l' && event.ctrlKey) {
      event.preventDefault();
      screen.replaceChildren();
    }
  });
  editorText.addEventListener('keydown', (event) => {
    if (!event.ctrlKey) return;
    if (event.key === 'x' || event.key === 'o' || event.key === 's') {
      event.preventDefault();
      void closeEditor(true);
    }
  });
  frame.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('button, textarea') && !window.getSelection()?.toString()) input.focus();
  });

  print('This is a pretend Linux inside ZeroPy. Nothing on your computer changes.\nType a command and press Enter. Try: ls', 'is-note');
  drawTree(new Set());
  void warmPython().catch(() => undefined);
  return {
    el,
    focus: () => input.focus(),
    dispose: () => (disposed = true),
  };
}

export function renderTerminal(step: TerminalStep, ctx: StepContext): StepView {
  let hintsShown = 0;
  let commands = 0;
  let helped = false;
  let solved = false;

  const checkRows = step.checks.map((check) =>
    h('li', { class: 'check' }, h('span', { class: 'check-mark' }), h('span', null, mdInline(check.pass))),
  );
  const feedback = h('div', { class: 'exercise-feedback', 'aria-live': 'polite' });
  const hintList = h('ol', { class: 'hints' });
  const hintButton = button(`Show a hint (1 of ${step.hints.length})`, { kind: 'ghost', small: true, icon: 'bulb', onClick: showHint });
  const solutionButton = button('Show the commands', { kind: 'ghost', small: true, onClick: showSolution });
  solutionButton.hidden = true;
  const solutionSlot = h('div', { class: 'solution-slot' });
  const reset = button('Start again', { kind: 'ghost', small: true, icon: 'loop', onClick: () => restart() });

  let term = createTerminal(startState(step), step.checks.map((c) => c.expr), onResult);
  const termSlot = h('div', { class: 'term-slot' }, term.el);

  const el = h(
    'div',
    { class: 'split split-wide' },
    h(
      'div',
      { class: 'split-text', 'data-enter': true },
      h('span', { class: 'tag tag-terminal' }, 'In the terminal'),
      md(step.prompt),
      h('h2', { class: 'todo-title' }, 'Done when'),
      h('ul', { class: 'checks' }, ...checkRows),
      feedback,
      hintList,
      h('div', { class: 'exercise-help' }, hintButton, solutionButton, reset),
      solutionSlot,
    ),
    h('div', { class: 'split-visual', 'data-enter': true }, termSlot),
  );

  function setChecks(states: boolean[]): void {
    checkRows.forEach((row, i) => {
      row.classList.toggle('is-pass', states[i] === true);
      row.classList.toggle('is-fail', false);
      row.querySelector('.check-mark')!.replaceChildren(states[i] ? icon('check', 14) : '');
    });
  }

  function onResult(result: ShellResult): void {
    commands += 1;
    setChecks(result.checks);
    const allPass = result.checks.length > 0 && result.checks.every(Boolean);
    if (allPass && !solved) {
      solved = true;
      ctx.grade(!helped && hintsShown === 0);
      // Needed the commands shown: it goes on the "My mistakes" list.
      noteAnswer(ctx.lesson.id, `step:${step.id}`, helped);
      ctx.done();
      const mark = h('span', { class: 'stamp stamp-big' }, 'Done');
      feedback.replaceChildren(panel('good', 'Everything is done.', step.after ? md(step.after, 'prose prose-small') : null));
      termSlot.append(mark);
      stamp(mark);
      confetti(mark, 18);
      window.setTimeout(() => mark.remove(), 2200);
      hintButton.hidden = true;
      solutionButton.hidden = false;
      solutionButton.querySelector('.btn-label')!.textContent = 'Compare with model commands';
      place(feedback.children);
    } else if (!solved && result.code === 127) {
      feedback.replaceChildren(panel('bad', 'Unknown command.', h('p', null, 'Check the spelling. Commands are short and lowercase, like ls, cd or mkdir.')));
      place(feedback.children);
      shake(termSlot);
    } else if (!solved) {
      feedback.replaceChildren();
    }
    if (!solved && commands >= 6 && hintsShown >= 1) solutionButton.hidden = false;
  }

  function showHint(): void {
    if (hintsShown >= step.hints.length) return;
    const item = h('li', null, mdInline(step.hints[hintsShown]));
    hintList.append(item);
    place(item);
    hintsShown += 1;
    if (hintsShown >= step.hints.length) {
      hintButton.hidden = true;
      solutionButton.hidden = false;
    } else hintButton.querySelector('.btn-label')!.textContent = `Show a hint (${hintsShown + 1} of ${step.hints.length})`;
  }

  function showSolution(): void {
    if (!solved) helped = true;
    solutionButton.hidden = true;
    solutionSlot.replaceChildren(
      h('div', { class: 'given-label' }, solved ? 'Model commands:' : 'These commands do it. Type them yourself:'),
      codeBlock(step.solution.join('\n')).el,
    );
    place(solutionSlot);
  }

  function restart(): void {
    term.dispose();
    term = createTerminal(startState(step), step.checks.map((c) => c.expr), onResult);
    termSlot.replaceChildren(term.el);
    if (!solved) setChecks(step.checks.map(() => false));
    place(term.el);
    term.focus();
  }

  ctx.dock.primary('Continue', false);
  ctx.dock.note('Type a command and press Enter. Tab completes a name, Up brings back the last command.');
  return {
    el,
    entered: () => term.focus(),
    dispose: () => term.dispose(),
  };
}
