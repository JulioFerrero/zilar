// Bundles the tool daemon to one self-contained file, `dist/desk-tool`, the
// same bytes cloud and runner run (plan §3.1). Everything is inlined (including
// `effect`) because the jail image has no `node_modules`; only `node:`
// built-ins stay external. `Dockerfile` copies the file in and chmods it.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ['src/serve.ts'],
  outfile: 'dist/desk-tool',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  logLevel: 'info',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
