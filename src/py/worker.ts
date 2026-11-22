/// <reference lib="webworker" />
// Runs Python (Pyodide) off the main thread. One request at a time.

interface PyodideLike {
  runPython(code: string): unknown;
  loadPackage(names: string | string[]): Promise<unknown>;
  globals: { get(name: string): (arg: string) => string };
}

type Incoming =
  | { type: 'init'; indexURL: string; harness: string }
  | { type: 'run'; id: number; request: string; fn?: 'run' | 'gui_event' | 'shell' };

let pyodide: PyodideLike | null = null;
let runFn: ((request: string) => string) | null = null;
// A click in a window of the last run (pretend tkinter).
let guiFn: ((request: string) => string) | null = null;
// One command of the pretend Linux terminal (shell.py).
let shellFn: ((request: string) => string) | null = null;

/**
 * Packages that are not in the Python core, but next to it in public/pyodide
 * (scripts/copy-pyodide.mjs). Each is loaded the first time a program
 * imports it, so lessons without it do not wait for it.
 */
const EXTRA: Record<string, RegExp> = {
  numpy: /(^|\n)[ \t]*(import[ \t]+numpy\b|from[ \t]+numpy\b)/,
};
const loaded = new Set<string>();

async function loadExtras(request: string): Promise<void> {
  if (!pyodide) return;
  let code = '';
  try {
    const parsed = JSON.parse(request) as { code?: string; line?: string };
    code = parsed.code ?? '';
  } catch {
    return;
  }
  for (const [name, pattern] of Object.entries(EXTRA)) {
    if (!loaded.has(name) && pattern.test(code)) {
      await pyodide.loadPackage(name);
      loaded.add(name);
    }
  }
}

async function init(indexURL: string, harness: string): Promise<void> {
  const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<PyodideLike>;
  };
  pyodide = await mod.loadPyodide({ indexURL });
  pyodide.runPython(harness);
  runFn = pyodide.globals.get('run');
  guiFn = pyodide.globals.get('gui_event');
  shellFn = pyodide.globals.get('shell');
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      await init(msg.indexURL, msg.harness);
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'failed', message: String(error) });
    }
    return;
  }
  if (msg.type === 'run') {
    try {
      if (msg.fn !== 'gui_event' && msg.fn !== 'shell') await loadExtras(msg.request);
      const result = (msg.fn === 'gui_event' ? guiFn : msg.fn === 'shell' ? shellFn : runFn)!(msg.request);
      self.postMessage({ type: 'result', id: msg.id, result });
    } catch (error) {
      self.postMessage({ type: 'crash', id: msg.id, message: String(error) });
    }
  }
};
