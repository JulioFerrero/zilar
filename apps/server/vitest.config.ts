import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    // The default is one fork per CPU (11 here); a full run then peaks at
    // ~8.5-9.5 GB across the main process and its workers (T-0930). Capping
    // the workers cuts the peak to ~7.5 GB at a comparable wall time.
    maxWorkers: 4,
    globalSetup: ['./src/test-global-setup.ts'],
  },
});
