import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.GALENA_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
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
