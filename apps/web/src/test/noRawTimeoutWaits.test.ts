import { describe, expect, it } from 'vitest';

// Guard (T-0899): a test waits with the helpers in `src/test/wait.ts`
// (`flushMicrotasks`, `flushTasks`, `waitFor`), never with its own
// `setTimeout(resolve, 0)` tick. One-tick waits made CI red on 2026-10-09.
// The web tsconfig has no node `readdir`, so the files come from Vite's glob.

// `setTimeout(resolve, 0)` and its short parameter names.
const RAW_TICK = /\bsetTimeout\(\s*(?:resolve|res|r|done|ok)\s*,\s*0\s*\)/;

const testSources = import.meta.glob(['../**/*.test.ts', '../**/*.test.tsx', '../test/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('raw one-tick waits in tests', () => {
  it('finds the test files', () => {
    expect(Object.keys(testSources).length).toBeGreaterThan(100);
  });

  it('no test file calls setTimeout(resolve, 0) outside the wait helper', () => {
    const offenders = Object.entries(testSources)
      .filter(([path]) => path !== './wait.ts')
      .flatMap(([path, source]) =>
        source
          .split('\n')
          .flatMap((line, index) => (RAW_TICK.test(line) ? [`${path}:${index + 1}`] : [])),
      );
    expect(offenders, 'use flushTasks/flushMicrotasks/waitFor from @/test/wait').toEqual([]);
  });
});
