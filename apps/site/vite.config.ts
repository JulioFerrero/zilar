import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // three is the bulk of the bundle and is only needed by the lazily loaded hero scene
    chunkSizeWarningLimit: 800,
  },
});
