import { describe, expect, it } from 'vitest';
import { ratchetViolations, type RatchetFile } from './ratchet.js';

const PLAIN = 'export const add = (a: number, b: number) => a + b;\n';
const EFFECT = "import { Effect } from 'effect';\nexport const run = Effect.succeed(1);\n";
const NEEDS_EFFECT = 'export const load = () => fetch("/api/items");\n';
const MARKED_NEEDS_EFFECT = `// effect-plain: pure helper for the test\n${NEEDS_EFFECT}`;
const PATH = 'apps/server/src/feature.ts';

const check = (file: Partial<RatchetFile>): ReturnType<typeof ratchetViolations> =>
  ratchetViolations([{ path: PATH, branchSource: null, baseSource: null, ...file }]);

describe('ratchetViolations', () => {
  it('passes a new plain file', () => {
    expect(check({ branchSource: PLAIN, baseSource: null })).toEqual([]);
  });

  it('fails a new file that is needs-effect, with its signals and first hit', () => {
    expect(check({ branchSource: NEEDS_EFFECT, baseSource: null })).toEqual([
      {
        path: PATH,
        signals: ['H2'],
        firstHit: { line: 1, text: 'export const load = () => fetch("/api/items");' },
      },
    ]);
  });

  it('fails a file that was plain on the base and is needs-effect on the branch', () => {
    expect(check({ branchSource: NEEDS_EFFECT, baseSource: PLAIN })).toEqual([
      {
        path: PATH,
        signals: ['H2'],
        firstHit: { line: 1, text: 'export const load = () => fetch("/api/items");' },
      },
    ]);
  });

  it('passes a file that is needs-effect on both the base and the branch', () => {
    expect(check({ branchSource: NEEDS_EFFECT, baseSource: NEEDS_EFFECT })).toEqual([]);
  });

  it('passes a needs-effect file that carries an effect-plain marker (exempt)', () => {
    expect(check({ branchSource: MARKED_NEEDS_EFFECT, baseSource: null })).toEqual([]);
  });

  it('passes a deleted file', () => {
    expect(check({ branchSource: null, baseSource: NEEDS_EFFECT })).toEqual([]);
  });

  it('passes a file converted to Effect, even when it was needs-effect on the base', () => {
    expect(check({ branchSource: EFFECT, baseSource: NEEDS_EFFECT })).toEqual([]);
  });

  it('ignores files that are not counted sources', () => {
    const files: RatchetFile[] = [
      { path: 'apps/server/src/feature.test.ts', branchSource: NEEDS_EFFECT, baseSource: null },
      { path: 'docs/notes.ts', branchSource: NEEDS_EFFECT, baseSource: null },
    ];
    expect(ratchetViolations(files)).toEqual([]);
  });
});
