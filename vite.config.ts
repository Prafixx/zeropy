import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { validateLesson } from './src/engine/validate.ts';

/** Turns content/*.yaml into JS modules and validates lessons at build time. */
function contentYaml(): Plugin {
  return {
    name: 'zeropy-content-yaml',
    transform(source, id) {
      if (!id.endsWith('.yaml')) return null;
      const data = load(source);
      if (id.endsWith('lesson.yaml')) {
        const problems = validateLesson(data);
        if (problems.length) {
          this.error(`Invalid lesson ${id}:\n- ${problems.join('\n- ')}`);
        }
      }
      return { code: `export default ${JSON.stringify(data)};`, map: null };
    },
  };
}

/**
 * Only in the built app (web and desktop), not in the dev server: a strict
 * content policy (no script from anywhere else can run, even if one were
 * injected), no listing in search engines, and no referrer to other sites.
 * Python runs in a worker, so WebAssembly needs 'wasm-unsafe-eval'.
 */
const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self' https://api.github.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'self'",
].join('; ');

function safeHead(): Plugin {
  return {
    name: 'zeropy-safe-head',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: POLICY }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
    ],
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [contentYaml(), safeHead()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
});
