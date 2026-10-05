import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Lets component render tests import the real `@/`-aliased plain modules
// (e.g. `@/lib/roles`) instead of mocking the very helpers they verify.
// Only the alias is configured here; native primitives stay mocked per test.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
