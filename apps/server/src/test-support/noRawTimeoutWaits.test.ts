import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Guard (T-0899): a test waits with the helpers in `wait.ts` (`flushMicrotasks`,
// `waitFor`), never with its own `setTimeout(resolve, 0)` tick. One-tick waits
// made CI red on 2026-10-09.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');

// The helper owns the one real tick; this file names the pattern it bans.
const ALLOWED = new Set([join(HERE, 'wait.ts'), fileURLToPath(import.meta.url)]);

// `setTimeout(resolve, 0)` and its short parameter names.
const RAW_TICK = /\bsetTimeout\(\s*(?:resolve|res|r|done|ok)\s*,\s*0\s*\)/;

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : testFiles(path);
    }
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('raw one-tick waits in tests', () => {
  it('finds the test files', () => {
    expect(testFiles(SRC_ROOT).length).toBeGreaterThan(100);
  });

  it('no test file calls setTimeout(resolve, 0) outside the wait helper', () => {
    const offenders = testFiles(SRC_ROOT)
      .filter((path) => !ALLOWED.has(path))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            RAW_TICK.test(line) ? [`${path.slice(SRC_ROOT.length + 1)}:${index + 1}`] : [],
          ),
      );
    expect(offenders, 'use flushMicrotasks/waitFor from test-support/wait').toEqual([]);
  });
});
