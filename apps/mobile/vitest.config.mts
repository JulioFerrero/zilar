import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Lets component render tests import the real `@/`-aliased plain modules
// (e.g. `@/lib/roles`) instead of mocking the very helpers they verify.
// Only the alias is configured here; native primitives stay mocked per test.
export default defineConfig({
  resolve: {
    // @zilar/client-core has its own react/effect copies (web versions); the
    // hooks it ships must use this app's, as Metro does (metro.config.js).
    dedupe: ['react', 'react-dom', 'effect', '@effect/atom-react'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
