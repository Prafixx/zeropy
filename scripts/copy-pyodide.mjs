// Copies the Pyodide core runtime from node_modules into public/pyodide so the
// site is fully self-hosted (no CDN needed for the Python core).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pyodide');
const to = join(root, 'public', 'pyodide');

if (!existsSync(from)) {
  console.log('[copy-pyodide] pyodide is not installed yet, skipping');
  process.exit(0);
}

// Only what the app loads: the ES module loader (not the older pyodide.js),
// the WebAssembly runtime, the standard library and the package list.
const files = readdirSync(from).filter(
  (f) => /\.(mjs|wasm|zip)$/.test(f) || f === 'pyodide-lock.json',
);
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const f of files) cpSync(join(from, f), join(to, f));
console.log('[copy-pyodide] runtime copied to public/pyodide');
