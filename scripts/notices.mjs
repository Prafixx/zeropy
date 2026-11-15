// Writes THIRD-PARTY-NOTICES.txt: the license texts of every library and
// font that ships inside the app. Their licenses require these notices.
// Also copies the file into public/ so the app can show it.
// Run: node scripts/notices.mjs (runs before every build).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  '@fontsource/atkinson-hyperlegible',
  '@fontsource-variable/bricolage-grotesque',
  '@fontsource-variable/jetbrains-mono',
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
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'].map((f) => join(root, 'node_modules', name, f)).find(existsSync);
  return file ? readFileSync(file, 'utf8').trim() : null;
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

for (const [name, pkg] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const text = licenseText(name);
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
console.log(`[notices] ${found.size + 4} parts written to THIRD-PARTY-NOTICES.txt`);
