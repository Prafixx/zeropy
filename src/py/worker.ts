/// <reference lib="webworker" />
// Runs Python (Pyodide) off the main thread. One request at a time.

interface PyodideLike {
  runPython(code: string): unknown;
  globals: { get(name: string): (arg: string) => string };
}

type Incoming =
  | { type: 'init'; indexURL: string; harness: string }
  | { type: 'run'; id: number; request: string; fn?: 'run' | 'gui_event' };

let runFn: ((request: string) => string) | null = null;
// A click in a window of the last run (pretend tkinter).
let guiFn: ((request: string) => string) | null = null;

async function init(indexURL: string, harness: string): Promise<void> {
  const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<PyodideLike>;
  };
  const pyodide = await mod.loadPyodide({ indexURL });
  pyodide.runPython(harness);
  runFn = pyodide.globals.get('run');
  guiFn = pyodide.globals.get('gui_event');
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
      const result = (msg.fn === 'gui_event' ? guiFn : runFn)!(msg.request);
      self.postMessage({ type: 'result', id: msg.id, result });
    } catch (error) {
      self.postMessage({ type: 'crash', id: msg.id, message: String(error) });
    }
  }
};
