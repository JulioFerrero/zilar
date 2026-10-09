import { describe, expect, it } from 'vitest';
import {
  blankNonCode,
  buildEffectMap,
  checkNeedsEffectBaseline,
  classifySource,
  isCountedSource,
  markerReason,
  packageOf,
  allowedPaths,
  openTask,
  packageSummaries,
  parseBoard,
  signalHits,
  sourceFile,
  summarise,
} from './generate.js';

const EFFECT_SOURCE = "import { Effect } from 'effect';\nexport const run = Effect.succeed(1);\n";
const LEGACY_SOURCE = "import { z } from 'zod';\nexport const schema = z.string();\n";
const MARKER = '// effect-plain: pure parser of a constant';

const signalsOf = (source: string): string[] => sourceFile('apps/web/src/a.ts', source, []).signals;
const kindOfSource = (path: string, source: string): string => sourceFile(path, source, []).kind;

describe('classifySource', () => {
  it('calls a file with no imports plain', () => {
    expect(classifySource('export const x = 1;\n')).toEqual({ kind: 'plain', legacy: [] });
  });

  it('calls a file that imports Effect effect, including @effect packages', () => {
    expect(classifySource(EFFECT_SOURCE).kind).toBe('effect');
    expect(classifySource("import { x } from '@effect/platform';\n").kind).toBe('effect');
    expect(classifySource("export * from 'effect/Schema';\n").kind).toBe('effect');
  });

  it('calls a file that imports a legacy library legacy and names it', () => {
    expect(classifySource(LEGACY_SOURCE)).toEqual({ kind: 'legacy', legacy: ['zod'] });
    expect(classifySource("import { eq } from 'drizzle-orm/sql';\n").legacy).toEqual(['drizzle']);
    expect(
      classifySource("import { Hono } from 'hono';\nimport { cors } from '@hono/node';\n").legacy,
    ).toEqual(['hono']);
    expect(classifySource("import { create } from 'zustand';\n").legacy).toEqual(['zustand']);
  });

  it('lets legacy win when a file imports both Effect and a legacy library', () => {
    const both = `${EFFECT_SOURCE}${LEGACY_SOURCE}`;
    expect(classifySource(both)).toEqual({ kind: 'legacy', legacy: ['zod'] });
  });

  it('ignores type-only imports: a type import of Effect is not Effect, nor is a legacy type', () => {
    expect(classifySource("import type { ZodType } from 'zod';\n")).toEqual({
      kind: 'plain',
      legacy: [],
    });
    expect(classifySource("import type { Effect } from 'effect';\n").kind).toBe('plain');
  });

  it('reads re-exports as imports', () => {
    expect(classifySource("export { schema } from 'zod';\n").legacy).toEqual(['zod']);
  });

  it('does not mistake a package with a similar name for a legacy one', () => {
    expect(classifySource("import x from 'zodiac';\nimport y from 'honeycomb';\n")).toEqual({
      kind: 'plain',
      legacy: [],
    });
  });
});

describe('isCountedSource', () => {
  it('counts non-test TypeScript under apps, packages and scripts', () => {
    expect(isCountedSource('apps/server/src/app.ts')).toBe(true);
    expect(isCountedSource('packages/shared/src/view.tsx')).toBe(true);
    expect(isCountedSource('scripts/phone/run.ts')).toBe(true);
  });

  it('skips tests, declarations, fixtures, other folders and non-TypeScript files', () => {
    expect(isCountedSource('apps/server/src/app.test.ts')).toBe(false);
    expect(isCountedSource('apps/web/src/a.spec.tsx')).toBe(false);
    expect(isCountedSource('packages/x/src/types.d.ts')).toBe(false);
    expect(isCountedSource('apps/web/src/Button.cosmos.tsx')).toBe(false);
    expect(isCountedSource('apps/server/src/__tests__/helper.ts')).toBe(false);
    expect(isCountedSource('docs/effect-reference/index.ts')).toBe(false);
    expect(isCountedSource('apps/server/src/app.js')).toBe(false);
  });

  it('skips Cosmos fixtures and the test helpers (test-harness, test-support, fake-*)', () => {
    expect(isCountedSource('apps/web/src/components/ui/button.fixture.tsx')).toBe(false);
    expect(isCountedSource('packages/runner-tunnel/src/test-harness.ts')).toBe(false);
    expect(isCountedSource('apps/server/src/test-support.ts')).toBe(false);
    expect(isCountedSource('packages/agent-drivers/src/fake-opencode-server.ts')).toBe(false);
    expect(isCountedSource('apps/server/src/fakery-notes.ts')).toBe(true);
  });
});

describe('packageOf', () => {
  it('names the package by its first two folders, and scripts by itself', () => {
    expect(packageOf('apps/server/src/app.ts')).toBe('apps/server');
    expect(packageOf('packages/devtools/src/effect-map/generate.ts')).toBe('packages/devtools');
    expect(packageOf('scripts/phone/run.ts')).toBe('scripts');
  });
});

describe('signals (§1.4): one hit and one known false positive each', () => {
  it('H1 async control flow: hit on async and await, not on Promise<void> in a type', () => {
    expect(signalsOf('export async function go() {}\n')).toContain('H1');
    expect(signalsOf('export interface Job {\n  done: Promise<void>;\n}\n')).toEqual([]);
  });

  it('H2 network: hit on fetch(, not on a comment, a string, this.fetch( or fetchImpl(', () => {
    expect(signalsOf('export const load = () => fetch(url);\n')).toContain('H2');
    const falsePositives =
      "// call fetch(url) later\nexport const label = 'fetch(url)';\n" +
      'export const pick = (fetchImpl: typeof fetch) => fetchImpl(url);\n' +
      'export const self = (c: { fetch: () => void }) => c.fetch(url);\n';
    expect(signalsOf(falsePositives)).toEqual([]);
  });

  it('H3 timers: hit on setTimeout(, not on requestAnimationFrame(', () => {
    expect(signalsOf('export const wait = () => setTimeout(done, 10);\n')).toContain('H3');
    expect(signalsOf('export const frame = () => requestAnimationFrame(draw);\n')).toEqual([]);
  });

  it('H5 storage: hit on localStorage, not on a storage parameter', () => {
    expect(signalsOf("export const get = () => localStorage.getItem('k');\n")).toContain('H5');
    expect(
      signalsOf(
        "export function read(storage: Storage | null) {\n  return storage?.getItem('k');\n}\n",
      ),
    ).toEqual([]);
  });

  it('H8 node I/O import: hit on node:fs, not on node:path', () => {
    expect(signalsOf("import { readFileSync } from 'node:fs';\n")).toContain('H8');
    expect(signalsOf("import { join } from 'node:path';\nexport const p = join('a');\n")).toEqual(
      [],
    );
  });

  it('H9 native I/O import: hit on expo-file-system, not on a type-only import of it', () => {
    expect(signalsOf("import * as FS from 'expo-file-system';\n")).toContain('H9');
    expect(signalsOf("import type { FileInfo } from 'expo-file-system';\n")).toEqual([]);
  });

  it('W4 try/catch: hit on try and catch, not on the words in a comment or a string', () => {
    expect(
      signalsOf('export const f = () => {\n  try {\n    run();\n  } catch (e) {}\n};\n'),
    ).toContain('W4');
    expect(signalsOf("// try { again later\nexport const word = 'catch (';\n")).toEqual([]);
  });

  it('W6 JSON.parse: hit on the call, not on the text inside a string', () => {
    expect(signalsOf('export const parse = (s: string) => JSON.parse(s);\n')).toContain('W6');
    expect(signalsOf("export const doc = 'JSON.parse(text) is the call';\n")).toEqual([]);
  });

  it('W7 env read: hit on process.env, not on a comment or an EXPO_PUBLIC_ string', () => {
    expect(signalsOf('export const url = process.env.API_URL;\n')).toContain('W7');
    expect(
      signalsOf(
        "// process.env.API_URL is read in the entry point\nexport const name = 'EXPO_PUBLIC_NAME';\n",
      ),
    ).toEqual([]);
  });

  it('lists every id that hits once, in the order H1 H2 H3 H5 H8 H9 W4 W6 W7', () => {
    expect(
      signalsOf("await fetch(x);\nJSON.parse(y);\nimport 'x';\nimport { a } from 'node:os';\n"),
    ).toEqual(['H1', 'H2', 'H8', 'W6']);
  });

  it('keeps a // inside a string, so the code after it still counts', () => {
    expect(signalsOf("export const u = 'http://x'; setTimeout(f, 1);\n")).toEqual(['H3']);
    expect(blankNonCode("const u = 'a//b'; // tail\n")).toBe("const u = ''; \n");
  });

  it('reports the first hit line, trimmed and cut to 120 characters', () => {
    const file = sourceFile(
      'apps/web/src/a.ts',
      'export const a = 1;\n  export const w = fetch(x);\n',
      [],
    );
    expect(file.firstHit).toEqual({ line: 2, text: 'export const w = fetch(x);' });
    const long = `export const w = fetch('${'x'.repeat(200)}');`;
    expect(sourceFile('apps/web/src/a.ts', long, []).firstHit?.text).toHaveLength(120);
  });

  it('returns no hit line for a file with no signal', () => {
    expect(sourceFile('apps/web/src/a.ts', 'export const a = 1;\n', []).firstHit).toBeNull();
    expect(signalHits('export const a = 1;\n')).toEqual([]);
  });
});

describe('classes and exemptions (§1.4)', () => {
  it('calls a file with a hard signal and no Effect needs-effect', () => {
    expect(kindOfSource('apps/web/src/a.ts', 'export async function go() {}\n')).toBe(
      'needs-effect',
    );
  });

  it('calls a file with only a weak signal needs-effect too', () => {
    expect(kindOfSource('apps/web/src/a.ts', 'export const p = JSON.parse(s);\n')).toBe(
      'needs-effect',
    );
  });

  it('reads a marker only in the first 15 lines: line 15 is exempt, line 20 is not', () => {
    const body = 'export async function run() {}\n';
    expect(kindOfSource('apps/web/src/a.ts', `${'\n'.repeat(14)}${MARKER}\n${body}`)).toBe(
      'exempt',
    );
    expect(kindOfSource('apps/web/src/a.ts', `${'\n'.repeat(19)}${MARKER}\n${body}`)).toBe(
      'needs-effect',
    );
  });

  it('takes the marker reason, and an empty reason is not a marker', () => {
    expect(markerReason(`${MARKER}\n`)).toBe('pure parser of a constant');
    expect(markerReason('// effect-plain:\nexport const a = 1;\n')).toBeNull();
    expect(markerReason('export const a = 1;\n')).toBeNull();
  });

  it('exempts the devtools package, apps/site, mock folders and config files', () => {
    const hard = 'export const t = setTimeout(f, 1);\n';
    expect(kindOfSource('packages/devtools/src/lead/x.ts', hard)).toBe('exempt');
    expect(kindOfSource('apps/site/src/scene.ts', 'await fetch(x);\n')).toBe('exempt');
    expect(kindOfSource('apps/web/src/mock/store.ts', hard)).toBe('exempt');
    expect(kindOfSource('apps/web/src/store/app-mock.ts', hard)).toBe('exempt');
    expect(kindOfSource('apps/web/vite.config.ts', hard)).toBe('exempt');
    expect(kindOfSource('apps/mobile/ios/x.ts', hard)).toBe('exempt');
  });

  it('does not exempt a folder whose name only looks similar', () => {
    expect(kindOfSource('apps/web/src/mocking.ts', 'export const t = setTimeout(f, 1);\n')).toBe(
      'needs-effect',
    );
  });

  it('keeps legacy above exempt: a devtools file importing zod is legacy', () => {
    expect(kindOfSource('packages/devtools/src/x.ts', LEGACY_SOURCE)).toBe('legacy');
  });

  it('calls a file that imports Effect effect when no signal or exemption applies', () => {
    expect(kindOfSource('apps/server/src/a.ts', EFFECT_SOURCE)).toBe('effect');
  });

  it('calls a file with nothing in it plain', () => {
    expect(kindOfSource('apps/web/src/a.ts', 'export const a = 1;\n')).toBe('plain');
  });
});

describe('Tier B and the needs-weak count', () => {
  it('marks an Effect file with a hard signal as Tier B, and one with only weak signals as not', () => {
    const hard = sourceFile('apps/server/src/a.ts', `${EFFECT_SOURCE}setTimeout(f, 1);\n`, []);
    const weak = sourceFile('apps/server/src/b.ts', `${EFFECT_SOURCE}JSON.parse(s);\n`, []);
    expect(hard.kind).toBe('effect');
    expect(hard.tierB).toBe(true);
    expect(weak.kind).toBe('effect');
    expect(weak.tierB).toBe(false);
  });

  it('never marks a needs-effect or plain file as Tier B', () => {
    expect(sourceFile('apps/web/src/a.ts', 'setTimeout(f, 1);\n', []).tierB).toBe(false);
    expect(sourceFile('apps/web/src/b.ts', 'export const a = 1;\n', []).tierB).toBe(false);
  });

  it('counts needs-effect files whose only hits are weak, by lines', () => {
    const files = [
      sourceFile('apps/web/src/a.ts', 'export const p = JSON.parse(s);\n' + '\n'.repeat(9), []),
      sourceFile('apps/web/src/b.ts', 'export async function go() {}\n', []),
    ];
    const total = summarise(files);
    expect(total.needsWeak).toEqual({ files: 1, lines: files[0]?.lines ?? 0 });
    expect(total.tierB).toEqual({ files: 0, lines: 0 });
  });
});

describe('coverage and the summary', () => {
  it('is Effect lines over Effect plus needs-effect lines, ignoring plain and exempt lines', () => {
    const effect = sourceFile('apps/server/src/a.ts', EFFECT_SOURCE + '\n'.repeat(7), []);
    const needs = sourceFile(
      'apps/web/src/b.ts',
      'export const w = fetch(x);' + '\n'.repeat(29),
      [],
    );
    const plain = sourceFile('apps/web/src/c.ts', 'export const c = 1;' + '\n'.repeat(99), []);
    const exempt = sourceFile('packages/devtools/src/d.ts', 'await x;' + '\n'.repeat(49), []);
    expect(effect.lines).toBe(10);
    expect(needs.lines).toBe(30);
    const total = summarise([effect, needs, plain, exempt]);
    expect(total.coveragePct).toBe(25);
    expect(total.kinds.plain.files).toBe(1);
    expect(total.kinds.exempt.files).toBe(1);
  });

  it('reads 100 when there is no Effect and no needs-effect line, including an empty list', () => {
    expect(summarise([]).coveragePct).toBe(100);
    expect(
      summarise([sourceFile('apps/web/src/a.ts', 'export const a = 1;\n', [])]).coveragePct,
    ).toBe(100);
  });

  it('keeps the old imports-Effect share as a secondary figure', () => {
    // Both files have 12 lines, so the imports-Effect share and the coverage are both 50.
    const files = [
      sourceFile('apps/server/src/a.ts', EFFECT_SOURCE + '\n'.repeat(9), []),
      sourceFile('apps/web/src/b.ts', 'export const b = fetch(x);' + '\n'.repeat(11), []),
    ];
    expect(files.map((f) => f.lines)).toEqual([12, 12]);
    const total = summarise(files);
    expect(total.effectLinesPct).toBe(50);
    expect(total.coveragePct).toBe(50);
  });

  it('lists every marker file with its reason and flags more than 25 without throwing', () => {
    const marked = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        sourceFile(`apps/web/src/m${i}.ts`, `${MARKER}\nexport const a = 1;\n`, []),
      );
    const within = summarise(marked(25));
    expect(within.markers).toHaveLength(25);
    expect(within.markers[0]).toEqual({
      path: 'apps/web/src/m0.ts',
      reason: 'pure parser of a constant',
    });
    expect(within.markersOverBudget).toBe(false);
    const over = summarise(marked(26));
    expect(over.markers).toHaveLength(26);
    expect(over.markersOverBudget).toBe(true);
  });

  it('puts the coverage into the total and into each package', () => {
    const files = [sourceFile('apps/server/src/a.ts', EFFECT_SOURCE, [])];
    const map = buildEffectMap({
      files,
      tasks: [],
      generatedAt: '2026-10-09T00:00:00.000Z',
      commit: 'abc1234',
      commitSubject: 'Spec T-0758',
    });
    expect(map.total.coveragePct).toBe(100);
    expect(map.packages[0]?.coveragePct).toBe(100);
  });
});

describe('checkNeedsEffectBaseline (the ratchet flag)', () => {
  const map = buildEffectMap({
    files: [sourceFile('apps/web/src/a.ts', 'export async function go() {}\n', [])],
    tasks: [],
    generatedAt: '2026-10-09T00:00:00.000Z',
    commit: 'abc1234',
    commitSubject: 'Spec T-0758',
  });

  it('passes when the needs-effect count is at or under the baseline', () => {
    expect(checkNeedsEffectBaseline(map, '{"needsEffectFiles": 1}')).toBeNull();
    expect(checkNeedsEffectBaseline(map, '{"needsEffectFiles": 5}')).toBeNull();
  });

  it('fails with a message when the count is higher than the baseline', () => {
    expect(checkNeedsEffectBaseline(map, '{"needsEffectFiles": 0}')).toBe(
      'needs-effect files 1 exceed the baseline 0',
    );
  });

  it('refuses a baseline file that is not the expected shape', () => {
    expect(checkNeedsEffectBaseline(map, '{"count": 1}')).toBe(
      'baseline must be JSON {"needsEffectFiles": number}',
    );
  });
});

describe('parseBoard', () => {
  const board = [
    '# Board',
    '',
    '| Task | Title | Status | Model | Deps | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
    '| [T-0752](T-0752-effect-map-pages.md) | self-updating map | in-progress | haiku-5.5 | | |',
    '| [T-0618](T-0618-test-speed-audit.md) | test speed | todo | | | |',
    '| [T-0700](T-0700-review.md) | a review | review | | | |',
    '| [T-0701](T-0701-blocked.md) | blocked one | blocked | | | |',
    '| [T-0009](T-0009-git-proxy.md) | old git proxy | merged | | | |',
    '| [T-0001](T-0001-monorepo.md) | Monorepo scaffold | 2026-09-27 |',
    '| [T-0702](T-0702-planned.md) | planned | planned | | | |',
    '| [T-0703](../etc/passwd.md) | bad link | todo | | | |',
  ].join('\n');

  it('keeps only rows whose status cell is todo, in-progress, review or blocked', () => {
    expect(parseBoard(board)).toEqual([
      {
        id: 'T-0752',
        file: 'T-0752-effect-map-pages.md',
        title: 'self-updating map',
        status: 'in-progress',
      },
      { id: 'T-0618', file: 'T-0618-test-speed-audit.md', title: 'test speed', status: 'todo' },
      { id: 'T-0700', file: 'T-0700-review.md', title: 'a review', status: 'review' },
      { id: 'T-0701', file: 'T-0701-blocked.md', title: 'blocked one', status: 'blocked' },
    ]);
  });
});

describe('allowedPaths', () => {
  // The shape of work/T-0009-git-proxy.md: a "Not allowed" line under the list.
  const shape = [
    '### Allowed files',
    '- `apps/server/src/git/**` (new module)',
    '- `apps/server/src/config.ts` — **only** to add new env entries',
    '- `pnpm-lock.yaml`',
    '- `work/T-0009-git-proxy.md`',
    '',
    '**Not allowed:** `apps/web/**`, `apps/mobile/**`, `packages/**`, `infra/**`,',
    '`docs/**`. If you need a change there, describe it in the Report and stop.',
    '',
    '> Other workers have edited `pnpm-lock.yaml`. Do not resolve a lockfile conflict.',
    '',
    '### Checks',
    '`apps/server/src/never.ts` is after the section',
  ].join('\n');

  it('takes the list paths and leaves out the "Not allowed" paths', () => {
    expect(allowedPaths(shape)).toEqual([
      'apps/server/src/git/**',
      'apps/server/src/config.ts',
      'pnpm-lock.yaml',
      'work/T-0009-git-proxy.md',
    ]);
  });

  it('reads inline paths on a paragraph line and ignores words without a slash or extension', () => {
    const text =
      '### Allowed files\nEdit `apps/web/src/a.ts` and `HttpError`, nothing else.\n### Checks\n';
    expect(allowedPaths(text)).toEqual(['apps/web/src/a.ts']);
  });

  it('returns nothing when the task has no Allowed files section', () => {
    expect(allowedPaths('### Checks\n`apps/web/src/a.ts`\n')).toEqual([]);
  });
});

describe('openTask', () => {
  const spec = [
    '---',
    'id: T-0999',
    'title: "move the thing"',
    'status: merged',
    '---',
    '',
    '### Allowed files',
    '`packages/devtools/src/effect-map/generate.ts`, `apps/web/src/lib/**`',
    '',
    '### Checks',
    '`apps/web/src/never.ts` is not an allowed file here',
    '',
  ].join('\n');
  const row = {
    id: 'T-0999',
    file: 'T-0999-move-the-thing.md',
    title: 'board title',
    status: 'in-progress',
  };

  it('takes the id and status from the board and the title and matchers from the task file', () => {
    const task = openTask(row, spec);
    expect(task.id).toBe('T-0999');
    expect(task.title).toBe('move the thing');
    expect(task.status).toBe('in-progress');
    expect(task.matchers).toHaveLength(2);
  });

  it('falls back to the board title when the task file is missing', () => {
    const task = openTask(row, '');
    expect(task.title).toBe('board title');
    expect(task.matchers).toEqual([]);
  });

  it('cuts a long title to 120 characters and marks the cut', () => {
    const title = openTask(row, spec.replace('move the thing', 'x'.repeat(150))).title;
    expect(title).toHaveLength(120);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('sourceFile and buildEffectMap', () => {
  const open = [
    openTask(
      { id: 'T-0999', file: 'T-0999-move-the-thing.md', title: 'move', status: 'review' },
      '---\ntitle: "move"\nstatus: review\n---\n\n### Allowed files\n`apps/web/src/lib/**`\n\n### Checks\n',
    ),
  ];

  it('marks a file with the open tasks whose Allowed files cover it', () => {
    const covered = sourceFile('apps/web/src/lib/format.ts', 'export {};', open);
    const other = sourceFile('apps/web/src/app.ts', 'export {};', open);
    expect(covered.tasks).toEqual([{ id: 'T-0999', title: 'move', status: 'review' }]);
    expect(other.tasks).toEqual([]);
  });

  it('counts the files each open task covers, with the commit and the totals', () => {
    const files = [
      sourceFile('apps/web/src/lib/format.ts', 'export {};', open),
      sourceFile('apps/web/src/lib/time.ts', 'export {};', open),
      sourceFile('apps/web/src/app.ts', 'export {};', open),
    ];
    const map = buildEffectMap({
      files,
      tasks: open,
      generatedAt: '2026-10-09T00:00:00.000Z',
      commit: 'abc1234',
      commitSubject: 'Spec T-0752',
    });
    expect(map.tasks).toEqual([{ id: 'T-0999', title: 'move', status: 'review', files: 2 }]);
    expect(map.total.files).toBe(3);
    expect(map.commit).toBe('abc1234');
    expect(map.files).toHaveLength(3);
  });
});

describe('packageSummaries', () => {
  it('groups files by package, biggest package first', () => {
    const files = [
      sourceFile('packages/shared/src/x.ts', 'export {};', []),
      sourceFile('apps/web/src/a.tsx', LEGACY_SOURCE.repeat(50), []),
      sourceFile('apps/web/src/b.tsx', EFFECT_SOURCE.repeat(50), []),
    ];
    const packages = packageSummaries(files);
    expect(packages.map((p) => p.name)).toEqual(['apps/web', 'packages/shared']);
    expect(packages[0]?.files).toBe(2);
    expect(packages[0]?.kinds.legacy.files).toBe(1);
    expect(packages[0]?.kinds.effect.files).toBe(1);
  });
});
