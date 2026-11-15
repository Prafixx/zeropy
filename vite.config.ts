import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
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

export default defineConfig({
  base: './',
  plugins: [contentYaml()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
});
