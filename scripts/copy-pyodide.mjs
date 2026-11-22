// Copies the Pyodide core runtime from node_modules into public/pyodide so the
// site is fully self-hosted (no CDN while the app runs), plus the few extra
// packages that lessons use (numpy, Flask). An extra package is downloaded once
// into node_modules/.cache, and its SHA-256 must match: the one in
// pyodide-lock.json (the list that came with the pyodide package) for Pyodide
// builds, the one pinned below for pure-Python wheels from PyPI. The PyPI
// wheels are added to the copied pyodide-lock.json, so loadPackage('flask')
// finds them and their dependencies.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pyodide');
const to = join(root, 'public', 'pyodide');
const cache = join(root, 'node_modules', '.cache', 'zeropy-wheels');

/** Packages that lessons import. They must have no dependencies outside this list. */
const EXTRA = ['numpy', 'markupsafe', 'jinja2', 'click'];

/** Pure-Python wheels from PyPI, not built by Pyodide. Pinned: version, file and SHA-256 (pypi.org/pypi/NAME/json). */
const PYPI = [
  { name: 'blinker', version: '1.9.0', imports: ['blinker'], depends: [],
    url: 'https://files.pythonhosted.org/packages/10/cb/f2ad4230dc2eb1a74edf38f1a38b9b52277f75bef262d8908e60d957e13c/blinker-1.9.0-py3-none-any.whl',
    sha256: 'ba0efaa9080b619ff2f3459d1d500c57bddea4a6b424b60a91141db6fd2f08bc' },
  { name: 'itsdangerous', version: '2.2.0', imports: ['itsdangerous'], depends: [],
    url: 'https://files.pythonhosted.org/packages/04/96/92447566d16df59b2a776c0fb82dbc4d9e07cd95062562af01e408583fc4/itsdangerous-2.2.0-py3-none-any.whl',
    sha256: 'c6242fc49e35958c8b15141343aa660db5fc54d4f13a1db01a3f5891b98700ef' },
  { name: 'werkzeug', version: '3.1.9', imports: ['werkzeug'], depends: ['markupsafe'],
    url: 'https://files.pythonhosted.org/packages/a1/38/df03f564f43cec2684823f3cccae1a652ee7face1cbaa76fb223096e64d7/werkzeug-3.1.9-py3-none-any.whl',
    sha256: '6392e50c78460ba618e5b21f08a71f59c99ce99cdc6cf6e3dd7e6ccca8754fab' },
  { name: 'flask', version: '3.1.3', imports: ['flask'], depends: ['blinker', 'click', 'itsdangerous', 'jinja2', 'markupsafe', 'werkzeug'],
    url: 'https://files.pythonhosted.org/packages/7f/9c/34f6962f9b9e9c71f6e5ed806e0d0ff03c9d1b0b2340088a0cf4bce09b18/flask-3.1.3-py3-none-any.whl',
    sha256: 'f4bcbefc124291925f1a26446da31a5178f9483862233b23c0c96a20701f670c' },
];

if (!existsSync(from)) {
  console.log('[copy-pyodide] pyodide is not installed yet, skipping');
  process.exit(0);
}

// Only what the app loads: the ES module loader (not the older pyodide.js),
// the WebAssembly runtime, the standard library and the package list.
const files = readdirSync(from).filter((f) => /\.(mjs|wasm|zip)$/.test(f));
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
  await fetchWheel(pkg.file_name, `https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`, pkg.sha256);
}
const known = new Set([...EXTRA, ...PYPI.map((p) => p.name)]);
for (const p of PYPI) {
  const missing = p.depends.filter((d) => !known.has(d));
  if (missing.length) throw new Error(`[copy-pyodide] ${p.name} needs ${missing.join(', ')}: add them to EXTRA or PYPI`);
  const fileName = p.url.split('/').pop();
  await fetchWheel(fileName, p.url, p.sha256);
  lock.packages[p.name] = {
    depends: p.depends, file_name: fileName, imports: p.imports, install_dir: 'site', name: p.name,
    package_type: 'package', sha256: p.sha256, tool: {}, unvendored_tests: false, version: p.version,
  };
}
writeFileSync(join(to, 'pyodide-lock.json'), JSON.stringify(lock));
console.log(`[copy-pyodide] runtime copied to public/pyodide, with ${[...known].join(', ')}`);

/** Copies one wheel from the cache into public/pyodide; downloads it first when it is missing or changed. */
async function fetchWheel(fileName, url, expected) {
  const cached = join(cache, fileName);
  if (!existsSync(cached) || sha256(readFileSync(cached)) !== expected) {
    console.log(`[copy-pyodide] downloading ${fileName}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[copy-pyodide] ${url}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== expected) throw new Error(`[copy-pyodide] ${fileName}: the checksum does not match`);
    writeFileSync(cached, data);
  }
  cpSync(cached, join(to, fileName));
}
