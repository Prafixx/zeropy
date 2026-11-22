// Copies the Pyodide core runtime from node_modules into public/pyodide so the
// site is fully self-hosted (no CDN while the app runs), plus the few extra
// packages that lessons use (numpy). An extra package is downloaded once from
// the official Pyodide CDN into node_modules/.cache, and its SHA-256 must match
// the one in pyodide-lock.json (the list that came with the pyodide package).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pyodide');
const to = join(root, 'public', 'pyodide');
const cache = join(root, 'node_modules', '.cache', 'zeropy-wheels');

/** Packages that lessons import. They must have no dependencies outside this list. */
const EXTRA = ['numpy'];

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

const version = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version;
const lock = JSON.parse(readFileSync(join(from, 'pyodide-lock.json'), 'utf8'));
mkdirSync(cache, { recursive: true });
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
for (const name of EXTRA) {
  const pkg = lock.packages[name];
  if (!pkg) throw new Error(`[copy-pyodide] ${name} is not in pyodide-lock.json`);
  const missing = pkg.depends.filter((d) => !EXTRA.includes(d));
  if (missing.length) throw new Error(`[copy-pyodide] ${name} needs ${missing.join(', ')}: add them to EXTRA`);
  const cached = join(cache, pkg.file_name);
  if (!existsSync(cached) || sha256(readFileSync(cached)) !== pkg.sha256) {
    const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`;
    console.log(`[copy-pyodide] downloading ${pkg.file_name}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[copy-pyodide] ${url}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== pkg.sha256) throw new Error(`[copy-pyodide] ${pkg.file_name}: the checksum does not match pyodide-lock.json`);
    writeFileSync(cached, data);
  }
  cpSync(cached, join(to, pkg.file_name));
}
console.log(`[copy-pyodide] runtime copied to public/pyodide, with ${EXTRA.join(', ')}`);
