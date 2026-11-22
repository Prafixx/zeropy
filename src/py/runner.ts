// Main-thread client for the Python worker. Lazy start, timeout, restart.
import type { GuiEvent, GuiResult, RunRequest, RunResult, ShellRequest, ShellResult } from '@/engine/types';
import harnessCode from './harness.py?raw';
import shellCode from './shell.py?raw';
import gpioCode from './gpio.py?raw';
import plotCode from './plot.py?raw';

// The pretend Linux shell, Raspberry Pi and matplotlib extend the harness.
const harness = `${harnessCode}\n${shellCode}\n${gpioCode}\n${plotCode}`;

export type PyStatus = 'idle' | 'loading' | 'ready' | 'failed';

const TIMEOUT_MS = 6000;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let status: PyStatus = 'idle';
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<(s: PyStatus) => void>();

function setStatus(next: PyStatus): void {
  status = next;
  listeners.forEach((fn) => fn(next));
}

export function pyStatus(): PyStatus {
  return status;
}

export function onPyStatus(fn: (s: PyStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

/** Starts loading Python. Safe to call many times. */
export function warmPython(): Promise<void> {
  if (ready) return ready;
  setStatus('loading');
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  ready = new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data.type === 'ready') {
        w.removeEventListener('message', onMessage);
        setStatus('ready');
        resolve();
      } else if (event.data.type === 'failed') {
        w.removeEventListener('message', onMessage);
        setStatus('failed');
        ready = null;
        reject(new Error(event.data.message));
      }
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', (event) => {
      setStatus('failed');
      ready = null;
      reject(new Error(event.message));
    });
  });
  const indexURL = new URL('pyodide/', document.baseURI).href;
  w.postMessage({ type: 'init', indexURL, harness });
  return ready;
}

function restart(): void {
  worker?.terminate();
  worker = null;
  ready = null;
  setStatus('idle');
  void warmPython().catch(() => undefined);
}

const TIMEOUT_RESULT: RunResult = {
  stdout: '',
  error: {
    type: 'Timeout',
    message: 'The program ran for more than 6 seconds.',
    line: null,
    traceback: 'Timeout: the program ran for more than 6 seconds and was stopped.',
  },
  vars: [],
  steps: [],
  checks: [],
};

/** One command in the pretend Linux terminal. Queued like a run. */
export function runShell(request: ShellRequest): Promise<ShellResult> {
  const next = queue.then(
    () => shellNow(request),
    () => shellNow(request),
  );
  queue = next.catch(() => undefined);
  return next;
}

async function shellNow(request: ShellRequest): Promise<ShellResult> {
  await warmPython();
  const w = worker!;
  const id = nextId++;
  return new Promise<ShellResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      w.removeEventListener('message', onMessage);
      restart();
      resolve({
        out: 'The command ran for more than 6 seconds and was stopped.\n',
        code: 124,
        state: request.state,
        prompt: '',
        clear: false,
        editor: null,
        checks: (request.checks ?? []).map(() => false),
      });
    }, TIMEOUT_MS);
    const onMessage = (msg: MessageEvent) => {
      if (msg.data.id !== id) return;
      window.clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (msg.data.type === 'result') resolve(JSON.parse(msg.data.result) as ShellResult);
      else reject(new Error(msg.data.message));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'run', id, fn: 'shell', request: JSON.stringify(request) });
  });
}

/** A click or a key in the window of the last run. Queued like a run. */
export function guiEvent(event: GuiEvent): Promise<GuiResult> {
  const next = queue.then(
    () => eventNow(event),
    () => eventNow(event),
  );
  queue = next.catch(() => undefined);
  return next;
}

async function eventNow(event: GuiEvent): Promise<GuiResult> {
  await warmPython();
  const w = worker!;
  const id = nextId++;
  return new Promise<GuiResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      w.removeEventListener('message', onMessage);
      restart();
      resolve({ gui: null, stdout: '', error: TIMEOUT_RESULT.error });
    }, TIMEOUT_MS);
    const onMessage = (msg: MessageEvent) => {
      if (msg.data.id !== id) return;
      window.clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (msg.data.type === 'result') resolve(JSON.parse(msg.data.result) as GuiResult);
      else reject(new Error(msg.data.message));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'run', id, fn: 'gui_event', request: JSON.stringify(event) });
  });
}

async function runNow(request: RunRequest): Promise<RunResult> {
  await warmPython();
  const w = worker!;
  const id = nextId++;
  return new Promise<RunResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      w.removeEventListener('message', onMessage);
      restart();
      resolve({ ...TIMEOUT_RESULT, checks: (request.checks ?? []).map(() => ({ pass: false, case: null, note: null })) });
    }, TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (event.data.type === 'result') resolve(JSON.parse(event.data.result) as RunResult);
      else reject(new Error(event.data.message));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'run', id, request: JSON.stringify(request) });
  });
}

/** Runs learner code. Calls are queued so results never mix. */
export function runPython(request: RunRequest): Promise<RunResult> {
  const next = queue.then(
    () => runNow(request),
    () => runNow(request),
  );
  queue = next.catch(() => undefined);
  return next;
}
