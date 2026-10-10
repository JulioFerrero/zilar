// Bundles the server for production: `dist/index.mjs` (the server) and
// `dist/tool-worker.mjs` (the sandbox worker thread that `run-tool.ts` spawns).
//
// The workspace packages (`@zilar/*`) are TypeScript source, so they are
// bundled in. Every other bare import (npm dependencies, `node:` built-ins)
// stays external and is resolved from `node_modules` at run time. The build
// fails when a static external import is not a production dependency of this
// package, because the production image installs only those.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));

const externalNpmPackages = {
  name: 'external-npm-packages',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@zilar/') || args.path.startsWith('/')) {
        return undefined;
      }
      return { path: args.path, external: true };
    });
  },
};

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    index: 'src/index.ts',
    'tool-worker': 'src/sandbox/tool-worker.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  metafile: true,
  logLevel: 'info',
  plugins: [externalNpmPackages],
  // Bundled CommonJS code (and `require` calls inside it) needs a `require`.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const missing = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const entry of output.imports) {
    if (!entry.external || entry.path.startsWith('node:')) {
      continue;
    }
    const name = packageName(entry.path);
    const isProduction = name in (packageJson.dependencies ?? {});
    // PGlite is a devDependency that only tests load with `import()`.
    const isLazyDev =
      entry.kind === 'dynamic-import' && name in (packageJson.devDependencies ?? {});
    if (!isProduction && !isLazyDev) {
      missing.add(name);
    }
  }
}
if (missing.size > 0) {
  throw new Error(
    `The bundle imports packages that are not production dependencies of @zilar/server: ${[...missing].join(', ')}`,
  );
}
