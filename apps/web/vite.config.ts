import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { devStickerFiles } from './src/mock/dev-sticker-files';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [devStickerFiles(), react(), tailwindcss()],
  resolve: {
    alias: [{ find: '@', replacement: src }],
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.ZILAR_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // PERF-14: 142 files import `effect`, and the React runtime,
        // `better-auth` and the overlay kit were bundled into the entry. Split
        // the long-lived vendors out so the entry chunk (`index-*.js`) and the
        // lazy route chunks shrink and stay cacheable across deploys.
        //
        // Measured: `effect`/`better-auth`/Base UI alone leave the entry chunk
        // unchanged (636 kB) — they already sat in the shared route chunks
        // (`button`, `jsx-runtime`, `AuthProvider`), which did shrink. Adding
        // the React runtime (the audit's own `effect`/`react`/overlay list,
        // performance-audit.md:149) is what actually shrinks the entry to
        // ~425 kB, so it is included here.
        //
        // Rolldown only supports the function form of `manualChunks`.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('/node_modules/effect/')) {
            return 'vendor-effect';
          }
          if (id.includes('/node_modules/better-auth/')) {
            return 'vendor-better-auth';
          }
          if (id.includes('/node_modules/@base-ui/')) {
            return 'vendor-base-ui';
          }
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // vmThreads builds jsdom once per worker instead of once per file (it was
    // a third of the suite's time) and still gives every file its own globals.
    // The price: window.location cannot be redefined, so code that navigates
    // takes the navigation as an injected dependency (see goToLogin).
    pool: 'vmThreads',
    // vm pools never free a file's realm, so a long-lived worker grows until it
    // is recycled. Cap each worker's memory and the number of workers, or a
    // full run peaks at ~6.6 GB (T-0930). With 4 workers and a 512 MB limit the
    // measured peak is ~3.2 GB at a similar wall time.
    vmMemoryLimit: '512MB',
    maxWorkers: 4,
    setupFiles: ['./src/test/setup.ts'],
    // First full-app render in each file (renderApp) pays the cold
    // jsdom/module warm-up plus a full render: ~0.2-0.5 s idle, up to
    // 5.3 s in a forced full-suite run with a CPU burner (T-0036). That
    // cost is synchronous render work, not a wait fake timers could
    // remove, so the package gives every test headroom instead of
    // per-test timeouts that each new file's first test would need again.
    // No retries; findBy/waitFor keep their 1 s defaults, and hookTimeout
    // stays default (hooks only do cleanup).
    testTimeout: 15_000,
  },
});
