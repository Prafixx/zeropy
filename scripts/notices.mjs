// Writes THIRD-PARTY-NOTICES.txt: the license texts of every library and
// font that ships inside the app. Their licenses require these notices.
// Also copies the file into public/ so the app can show it.
// Run: node scripts/notices.mjs (runs before every build).
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgJson = (name) => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));

// Packages whose code or files end up in the app.
const SHIPPED = [
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lang-python',
  '@codemirror/language',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/highlight',
  'marked',
  'three',
  '@fontsource-variable/pixelify-sans',
  '@fontsource/silkscreen',
  '@fontsource-variable/figtree',
  '@fontsource-variable/jetbrains-mono',
  'electron-updater',
];
// Only used by Pyodide in Node.js, never shipped.
const NOT_SHIPPED = new Set(['ws', '@types/emscripten']);

const found = new Map();
function walk(name) {
  if (found.has(name) || NOT_SHIPPED.has(name) || !existsSync(join(root, 'node_modules', name))) return;
  const pkg = pkgJson(name);
  found.set(name, pkg);
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep);
}
SHIPPED.forEach(walk);

function licenseText(name) {
  // Any case: "LICENSE", "license.md", "Licence.txt". Linux file names are case-sensitive.
  const dir = join(root, 'node_modules', name);
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const line = '='.repeat(78);
const parts = [
  'ZeroPy - third-party notices',
  '',
  'ZeroPy includes the software and fonts listed below. Each part keeps its',
  'own license. The full license texts follow.',
  '',
];

function section(title, body) {
  parts.push(line, title, line, '', body.trim(), '');
}

// A few MIT packages ship no license file. The MIT License asks for its
// text and the copyright line, so they get the standard text here.
function mitText(pkg) {
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  if (pkg.license !== 'MIT' || !author) return null;
  return [
    'MIT License',
    '',
    `Copyright (c) ${author.replace(/\s*[<(].*$/, '')}`,
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  ].join('\n');
}

for (const [name, pkg] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const text = licenseText(name) ?? mitText(pkg);
  if (!text) throw new Error(`No license file for ${name}`);
  section(`${name} ${pkg.version} (${pkg.license})`, text);
}

const vite = pkgJson('vite');
section(
  `vite ${vite.version} (MIT) - small module preload helper inside the app code`,
  licenseText('vite').split('\n# Licenses of bundled dependencies')[0],
);

const gsap = pkgJson('gsap');
section(
  `gsap ${gsap.version} (GreenSock Standard "No Charge" License)`,
  [
    'GSAP is Copyright (c) GreenSock, Inc. (a Webflow company).',
    'Used under the GreenSock Standard "No Charge" License:',
    'https://gsap.com/standard-license',
  ].join('\n'),
);

const pyodide = pkgJson('pyodide');
section(
  `pyodide ${pyodide.version} (MPL-2.0)`,
  [
    'Pyodide runs Python in the app. The files are used without changes.',
    'Source code: https://github.com/pyodide/pyodide',
    '',
    readFileSync(join(root, 'licenses', 'pyodide-LICENSE.txt'), 'utf8'),
  ].join('\n'),
);
section(
  'NumPy, the Pyodide build in public/pyodide (BSD-3-Clause)',
  [
    'NumPy is used without changes. The licenses of the parts it bundles',
    '(for example pocketfft, LAPACK lite and the random generators) are inside',
    'the wheel file, in numpy-*.dist-info/licenses.',
    'Source code: https://github.com/numpy/numpy',
    '',
    readFileSync(join(root, 'licenses', 'numpy-LICENSE.txt'), 'utf8'),
  ].join('\n'),
);
// Flask and the packages it needs, in public/pyodide (scripts/copy-pyodide.mjs).
const PYTHON_PACKAGES = [
  ['Flask', '3.1.3', 'BSD-3-Clause', 'flask'],
  ['Werkzeug', '3.1.9', 'BSD-3-Clause', 'werkzeug'],
  ['Jinja2', '3.1.6', 'BSD-3-Clause', 'jinja2'],
  ['MarkupSafe', '3.0.3', 'BSD-3-Clause', 'markupsafe'],
  ['Click', '8.3.1', 'BSD-3-Clause', 'click'],
  ['itsdangerous', '2.2.0', 'BSD-3-Clause', 'itsdangerous'],
  ['Blinker', '1.9.0', 'MIT', 'blinker'],
];
for (const [name, version, license, file] of PYTHON_PACKAGES) {
  section(
    `${name} ${version}, a Python package in public/pyodide (${license})`,
    ['Used without changes.', '', readFileSync(join(root, 'licenses', `${file}-LICENSE.txt`), 'utf8')].join('\n'),
  );
}
section(
  'CPython 3.14 standard library and interpreter, inside Pyodide (PSF License)',
  [
    'Python and its standard library include software from other authors.',
    'Their notices: https://docs.python.org/3/license.html',
    '',
    readFileSync(join(root, 'licenses', 'cpython-LICENSE.txt'), 'utf8'),
  ].join('\n'),
);
section(
  'Electron and Chromium (desktop app only)',
  [
    'The Windows app is built with Electron (MIT License), which includes',
    'Chromium and other open source software. Their license texts are in the',
    'app folder: LICENSE.electron.txt and LICENSES.chromium.html.',
  ].join('\n'),
);

const text = `${parts.join('\n').replace(/\r\n/g, '\n')}\n`;
writeFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), text);
copyFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), join(root, 'public', 'THIRD-PARTY-NOTICES.txt'));
console.log(`[notices] ${found.size + 5 + PYTHON_PACKAGES.length} parts written to THIRD-PARTY-NOTICES.txt`);
