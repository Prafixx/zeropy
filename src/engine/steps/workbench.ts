// Editor + Run button + output + error card. Shared by demo and exercise.
import type { CodeEditor } from '@/editor/editor';
import { place } from '@/kit/motion';
import { explainError } from '@/py/errors';
import { guiEvent, onPyStatus, webRequest } from '@/py/runner';
import type { ChartFigure, GuiEvent, GuiTree, PyError, RunResult, ServerInfo, WebRequest, WebResult } from '../types';
import { createBrowser } from './browser';
import type { MiniBrowser } from './browser';
import { drawChart } from './chart';
import { createGuiWindow } from './gui-window';
import type { GuiWindow } from './gui-window';
import { button, h, icon } from '../ui';

export interface Workbench {
  el: HTMLElement;
  frame: HTMLElement;
  run(): void;
  /**
   * Runs a program that may call input(). Each time the program needs an
   * answer, the learner types it and the program runs again from the start
   * with all answers so far. Returns null when the learner stops.
   */
  interact(
    run: (stdin: string[], seed: number) => Promise<RunResult>,
  ): Promise<{ result: RunResult; stdin: string[] } | null>;
  setOutput(text: string): void;
  /** Shows the window of a tkinter program; its clicks run the program's code. */
  setWindow(tree?: GuiTree | null): void;
  /** Shows the charts of a program that used matplotlib.pyplot. */
  setCharts(figures?: ChartFigure[] | null): void;
  /** Shows a browser for the Flask app of a program that called app.run(). */
  setServer(info?: ServerInfo | null): void;
  /** Shows the files in the folder after a run (or the starting files). */
  setFiles(files?: Record<string, string>): void;
  showError(error: PyError | null): void;
  markLine(line: number | null, kind?: 'run' | 'error'): void;
  getCode(): string;
  setCode(code: string): void;
  dispose(): void;
}

export interface WorkbenchOptions {
  code: string;
  onRun: (code: string) => Promise<void>;
  onEdit?: () => void;
  /** Hide the code: the learner can only run the program. */
  sealed?: boolean;
  runLabel?: string;
  /** More room for the editor: for programs that grow over several steps. */
  tall?: boolean;
  /** Files in the folder before each run. */
  files?: Record<string, string>;
}

export function createWorkbench(options: WorkbenchOptions): Workbench {
  let editor: CodeEditor | null = null;
  let busy = false;
  let disposed = false;
  let pending = options.code.trimEnd();

  const status = h('span', { class: 'bench-status', 'aria-live': 'polite' });
  const runButton = button(options.runLabel ?? 'Run', { kind: 'primary', small: true, icon: 'play', onClick: () => run() });
  runButton.title = options.sealed ? 'Run the program' : 'Run the code (Ctrl + Enter)';
  const mount = options.sealed
    ? h(
        'div',
        { class: 'bench-sealed' },
        icon('lock', 22),
        h('span', null, 'The code of this program is hidden. You will write it yourself.'),
      )
    : h('div', { class: 'bench-editor' }, h('pre', { class: 'bench-placeholder' }, pending));
  const out = h('pre', { class: 'out-text', 'aria-label': 'Output of the program' });
  const inputSlot = h('div', { class: 'out-input-slot' });
  let cancelAsk: (() => void) | null = null;
  const errorSlot = h('div', { class: 'bench-error', 'aria-live': 'polite' });
  const filesSlot = h('div', { class: 'bench-files-slot', 'aria-live': 'polite' });
  const windowSlot = h('div', { class: 'bench-window-slot' });
  const chartsSlot = h('div', { class: 'bench-charts', 'aria-live': 'polite' });
  const serverSlot = h('div', { class: 'bench-server-slot' });
  let gui: GuiWindow | null = null;
  let browser: MiniBrowser | null = null;
  let printed = '';
  const frame = h(
    'div',
    { class: 'bench-frame' },
    h('div', { class: 'bench-bar' }, h('span', { class: 'bench-file' }, 'main.py'), status, runButton),
    mount,
  );
  const el = h(
    'div',
    { class: `bench${options.sealed ? ' is-sealed' : ''}${options.tall ? ' is-tall' : ''}` },
    frame,
    windowSlot,
    serverSlot,
    chartsSlot,
    h('div', { class: 'bench-out' }, h('div', { class: 'out-label' }, 'Output'), out, inputSlot),
    filesSlot,
    errorSlot,
  );
  setOutput('');
  setFiles();

  const stopStatus = onPyStatus((s) => {
    status.textContent =
      s === 'loading' ? 'Python is starting…' : s === 'failed' ? 'Python could not start. Reload the page.' : '';
    status.classList.toggle('is-bad', s === 'failed');
  });

  void import('@/editor/editor').then((m) => {
    if (disposed || options.sealed) return;
    mount.replaceChildren();
    editor = m.createEditor(mount, {
      doc: pending,
      label: 'Python code editor',
      onRun: () => run(),
      onChange: () => options.onEdit?.(),
    });
  });

  function setBusy(on: boolean): void {
    busy = on;
    runButton.disabled = on;
    frame.classList.toggle('is-busy', on);
  }

  function run(): void {
    if (busy) return;
    setBusy(true);
    options
      .onRun(getCode())
      .catch((error) => {
        console.error(error);
        setOutput('');
        status.textContent = 'Something went wrong. Try again.';
      })
      .finally(() => setBusy(false));
  }

  /** Shows a field under the output and waits for one answer. */
  function ask(): Promise<string | null> {
    return new Promise((resolve) => {
      const field = h('input', {
        class: 'out-field',
        type: 'text',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': 'Your answer for the program',
      });
      const finish = (value: string | null): void => {
        inputSlot.replaceChildren();
        cancelAsk = null;
        resolve(value);
      };
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') finish(field.value);
      });
      cancelAsk = () => finish(null);
      const row = h(
        'div',
        { class: 'out-input' },
        h('span', { class: 'out-input-label' }, 'The program waits. Type your answer:'),
        field,
        button('Enter', { kind: 'primary', small: true, onClick: () => finish(field.value) }),
        button('Stop', { kind: 'ghost', small: true, onClick: () => finish(null) }),
      );
      inputSlot.replaceChildren(row);
      place(row);
      field.focus();
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  async function interact(
    runWith: (stdin: string[], seed: number) => Promise<RunResult>,
  ): Promise<{ result: RunResult; stdin: string[] } | null> {
    const stdin: string[] = [];
    // One seed for all re-runs of this run: random numbers stay the same
    // while the learner answers, and change with the next press of Run.
    const seed = Math.floor(Math.random() * 2 ** 31);
    for (;;) {
      const result = await runWith(stdin, seed);
      if (disposed) return null;
      // A program that asks without end is stopped after 30 answers.
      if (!result.error?.needsInput || stdin.length >= 30) return { result, stdin };
      setOutput(result.stdout);
      showError(null);
      const answer = await ask();
      if (answer === null || disposed) return null;
      stdin.push(answer);
    }
  }

  function getCode(): string {
    return editor ? editor.getValue() : pending;
  }

  function setOutput(text: string): void {
    printed = text;
    out.textContent = text;
    out.classList.toggle('is-empty', text === '');
    if (text === '') out.textContent = 'Nothing printed yet.';
    // Long output: keep the newest lines in view.
    out.scrollTop = out.scrollHeight;
  }

  /** The window of a tkinter program. A click runs its callback in Python. */
  function setWindow(tree?: GuiTree | null): void {
    if (!tree) {
      gui?.update(null);
      return;
    }
    if (!gui) {
      gui = createGuiWindow((event) => void onGuiEvent(event));
      windowSlot.append(gui.el);
    }
    gui.update(tree, true);
  }

  function setCharts(figures?: ChartFigure[] | null): void {
    chartsSlot.replaceChildren(...(figures ?? []).map((fig) => drawChart(fig)));
    if (figures?.length) place(chartsSlot.children);
  }

  function setServer(info?: ServerInfo | null): void {
    if (!info?.served) {
      serverSlot.replaceChildren();
      browser = null;
      return;
    }
    if (!browser) {
      browser = createBrowser((request) => onWebRequest(request));
      serverSlot.append(browser.el);
      place(browser.el);
    }
    browser.start(info);
  }

  /** A request of the browser. The server log and the prints of the app go to the output. */
  async function onWebRequest(request: WebRequest): Promise<WebResult | null> {
    // Not blocked while a run is busy: the browser opens its first page at the
    // end of a run, and the runner's queue keeps runs and requests in order.
    if (disposed) return null;
    const result = await webRequest(request);
    if (disposed) return null;
    const more = `${result.stdout}${result.log ? `${result.log}\n` : ''}`;
    if (more) setOutput(printed + (printed && !printed.endsWith('\n') ? '\n' : '') + more);
    showError(result.error);
    return result;
  }

  async function onGuiEvent(event: GuiEvent): Promise<void> {
    if (busy || disposed) return;
    const result = await guiEvent(event);
    if (disposed) return;
    gui?.update(result.gui);
    if (result.stdout) setOutput(printed + result.stdout);
    showError(result.error);
    if (result.files) setFiles(result.files);
  }

  /**
   * The folder of the program: each file with its text. A file that the run
   * made or changed is marked, so the learner sees what the code did.
   */
  function setFiles(files?: Record<string, string>): void {
    const start = options.files ?? {};
    const now = files ?? start;
    const names = [...new Set([...Object.keys(now), ...(files ? Object.keys(start) : [])])];
    if (names.length === 0) {
      filesSlot.replaceChildren();
      return;
    }
    const cards = names.map((name) => {
      const gone = !(name in now);
      const mark = gone ? 'deleted' : !(name in start) ? 'new' : start[name] !== now[name] ? 'changed' : '';
      const text = gone ? '' : now[name];
      return h(
        'div',
        { class: `file-card${mark ? ` is-${mark}` : ''}` },
        h('div', { class: 'file-head' }, icon('file', 15), h('span', { class: 'file-name' }, name), mark ? h('span', { class: 'file-mark' }, mark) : null),
        gone ? null : h('pre', { class: `file-text${text === '' ? ' is-empty' : ''}` }, text === '' ? '(empty file)' : text),
      );
    });
    filesSlot.replaceChildren(
      h('div', { class: 'bench-files' }, h('div', { class: 'out-label' }, 'Files in the folder'), h('div', { class: 'file-list' }, ...cards)),
    );
  }

  function showError(error: PyError | null): void {
    if (!error) {
      errorSlot.replaceChildren();
      return;
    }
    const info = explainError(error);
    const card = h(
      'div',
      { class: 'errcard' },
      h('div', { class: 'errcard-head' }, icon('cross', 16), h('strong', null, error.type === 'Timeout' ? `${info.where}: the program was stopped` : `${info.where}: ${error.type}`)),
      h('p', null, info.what, ' ', info.tryThis),
      h('div', { class: 'errcard-label' }, 'Message from Python. Read the last line first.'),
      h('pre', { class: 'traceback' }, error.traceback),
    );
    errorSlot.replaceChildren(card);
    place(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return {
    el,
    frame,
    run,
    interact,
    setOutput,
    setWindow,
    setCharts,
    setServer,
    setFiles,
    showError,
    getCode,
    markLine: (line, kind) => editor?.markLine(line, kind),
    setCode(code) {
      pending = code;
      editor?.setValue(code);
    },
    dispose() {
      disposed = true;
      cancelAsk?.();
      stopStatus();
      editor?.destroy();
    },
  };
}
