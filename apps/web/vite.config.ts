import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
