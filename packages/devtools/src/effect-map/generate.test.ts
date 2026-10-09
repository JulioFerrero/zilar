import { describe, expect, it } from 'vitest';
import {
  buildEffectMap,
  classifySource,
  isCountedSource,
  packageOf,
  allowedPaths,
  openTask,
  packageSummaries,
  parseBoard,
  sourceFile,
  summarise,
} from './generate.js';

const EFFECT_SOURCE = "import { Effect } from 'effect';\nexport const run = Effect.succeed(1);\n";
const LEGACY_SOURCE = "import { z } from 'zod';\nexport const schema = z.string();\n";

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

  it('ignores type-only imports of legacy libraries but still counts Effect type imports', () => {
    expect(classifySource("import type { ZodType } from 'zod';\n")).toEqual({
      kind: 'plain',
      legacy: [],
    });
    expect(classifySource("import type { Effect } from 'effect';\n").kind).toBe('effect');
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
});

describe('packageOf', () => {
  it('names the package by its first two folders, and scripts by itself', () => {
    expect(packageOf('apps/server/src/app.ts')).toBe('apps/server');
    expect(packageOf('packages/devtools/src/effect-map/generate.ts')).toBe('packages/devtools');
    expect(packageOf('scripts/phone/run.ts')).toBe('scripts');
  });
});

describe('summarise', () => {
  const files = [
    sourceFile('apps/server/src/a.ts', EFFECT_SOURCE + '\n'.repeat(9), []),
    sourceFile('apps/server/src/b.ts', LEGACY_SOURCE, []),
    sourceFile('apps/server/src/c.ts', 'export const c = 1;', []),
    sourceFile('apps/server/src/d.ts', 'export const d = 1;', []),
  ];

  it('counts files and lines per kind and the Effect share by files and by lines', () => {
    const total = summarise(files);
    expect(total.files).toBe(4);
    expect(total.kinds.effect.files).toBe(1);
    expect(total.kinds.legacy.files).toBe(1);
    expect(total.kinds.plain.files).toBe(2);
    expect(total.effectFilesPct).toBe(25);
    expect(total.lines).toBe(files.reduce((sum, f) => sum + f.lines, 0));
    expect(total.effectLinesPct).toBe(
      Math.round(((files[0]?.lines ?? 0) / total.lines) * 1000) / 10,
    );
  });

  it('reports zero percentages for an empty list', () => {
    const empty = summarise([]);
    expect(empty.files).toBe(0);
    expect(empty.effectFilesPct).toBe(0);
    expect(empty.effectLinesPct).toBe(0);
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
