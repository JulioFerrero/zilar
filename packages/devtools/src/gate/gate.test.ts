import { describe, expect, it } from 'vitest';
import {
  gateSteps,
  packagesTouched,
  selectTestFiles,
  strayFiles,
  type WorkspacePackage,
} from './plan.js';
import { allowedTokens, scopeReport, tokenMatcher } from './scope.js';

const workspace: WorkspacePackage[] = [
  { name: '@zilar/mobile', dir: 'apps/mobile', hasTests: true },
  { name: '@zilar/server', dir: 'apps/server', hasTests: true },
  { name: '@zilar/docs', dir: 'packages/docs', hasTests: false },
];

const taskText = [
  '## Spec',
  '### Allowed files',
  '`apps/mobile/src/app/settings/**`, `apps/mobile/src/lib/profile-api.ts` and tests, `apps/mobile/src/lib/settings-items.ts` (one row)',
  '',
  '### Checks',
  '`pnpm lint`',
].join('\n');

describe('allowedTokens', () => {
  it('reads the backticked paths of the Allowed files section only', () => {
    expect(allowedTokens(taskText)).toEqual([
      'apps/mobile/src/app/settings/**',
      'apps/mobile/src/lib/profile-api.ts',
      'apps/mobile/src/lib/settings-items.ts',
    ]);
  });

  it('returns nothing when the section is missing', () => {
    expect(allowedTokens('## Spec\nno section')).toEqual([]);
  });
});

describe('tokenMatcher', () => {
  it('matches a folder glob, a file and a folder name', () => {
    expect(tokenMatcher('a/b/**').test('a/b/c/d.ts')).toBe(true);
    expect(tokenMatcher('a/b/c.ts').test('a/b/c.ts')).toBe(true);
    expect(tokenMatcher('a/b').test('a/b/c.ts')).toBe(true);
    expect(tokenMatcher('a/b/*.ts').test('a/b/c.ts')).toBe(true);
    expect(tokenMatcher('a/b/*.ts').test('a/b/c/d.ts')).toBe(false);
    expect(tokenMatcher('a/b/c.ts').test('a/b/c.tsx')).toBe(false);
  });
});

describe('scopeReport', () => {
  it('lists files outside the allowed paths and ignores the task file and the lockfile', () => {
    const report = scopeReport(taskText, [
      'apps/mobile/src/app/settings/profile.tsx',
      'apps/mobile/src/lib/settings-items.ts',
      'apps/mobile/src/auth/NameForm.tsx',
      'work/T-0181-mobile-settings-profile.md',
      'pnpm-lock.yaml',
    ]);
    expect(report).toEqual({ outside: ['apps/mobile/src/auth/NameForm.tsx'], unchecked: false });
  });

  it('is unchecked when the task names no paths', () => {
    expect(scopeReport('## Spec', ['a.ts'])).toEqual({ outside: [], unchecked: true });
  });
});

describe('selectTestFiles', () => {
  const testFiles = [
    'packages/a/src/service.test.ts',
    'packages/a/src/service.effect.test.ts',
    'packages/a/src/other.test.ts',
    'packages/a/src/nested/deep.test.ts',
    'packages/b/src/thing.test.ts',
  ];

  it('keeps a changed test file', () => {
    expect(selectTestFiles(['packages/a/src/other.test.ts'], testFiles)).toEqual([
      'packages/a/src/other.test.ts',
    ]);
  });

  it('drops a changed test file the branch deleted', () => {
    const onDisk = new Set(testFiles);
    expect(
      selectTestFiles(['packages/a/src/deleted.test.ts'], testFiles, (file) => onDisk.has(file)),
    ).toEqual([]);
  });

  it('selects the two sibling tests of a source file', () => {
    expect(selectTestFiles(['packages/a/src/service.ts'], testFiles)).toEqual([
      'packages/a/src/service.effect.test.ts',
      'packages/a/src/service.test.ts',
    ]);
  });

  it('selects nothing for a source file with no sibling test', () => {
    expect(selectTestFiles(['packages/a/src/lonely.ts'], testFiles)).toEqual([]);
  });

  it('ignores a non-code file', () => {
    expect(selectTestFiles(['packages/a/readme.md'], testFiles)).toEqual([]);
  });
});

describe('gateSteps', () => {
  it('runs install, format, lint and typecheck, then only the nearest tests', () => {
    const steps = gateSteps(
      ['apps/mobile/src/a.ts', 'apps/mobile/src/a.test.ts'],
      workspace,
      'main',
      { testFiles: ['apps/mobile/src/a.test.ts'] },
    );
    expect(steps.map((step) => step.label)).toEqual([
      'install (frozen)',
      'format',
      'lint',
      'typecheck',
      'tests @zilar/mobile',
    ]);
    expect(steps.at(-1)?.args).toEqual([
      '--filter',
      '@zilar/mobile',
      'test',
      '--maxWorkers=2',
      'src/a.test.ts',
    ]);
  });

  it('skips a touched package with no nearby test files', () => {
    const steps = gateSteps(['apps/mobile/src/a.ts', 'packages/docs/readme.md'], workspace, 'main');
    expect(steps.at(-1)).toMatchObject({
      label: 'tests @zilar/mobile',
      skipReason: 'no nearby test files',
    });
  });

  it('skips a touched package whose only changed test file was deleted', () => {
    const steps = gateSteps(['apps/mobile/src/a.test.ts'], workspace, 'main', {
      testFiles: [],
      exists: () => false,
    });
    expect(steps.at(-1)).toMatchObject({
      label: 'tests @zilar/mobile',
      skipReason: 'no nearby test files',
    });
  });

  it('selects the nearest tests of two packages', () => {
    const steps = gateSteps(
      ['apps/mobile/src/a.ts', 'apps/server/src/b.ts', 'apps/server/src/b.test.ts'],
      workspace,
      'main',
      { testFiles: ['apps/server/src/b.test.ts'] },
    );
    expect(steps.slice(4).map((step) => step.label)).toEqual([
      'tests @zilar/mobile',
      'tests @zilar/server',
    ]);
    expect(steps.at(-1)?.args).toEqual([
      '--filter',
      '@zilar/server',
      'test',
      '--maxWorkers=2',
      'src/b.test.ts',
    ]);
  });

  it('keeps the --changed step for the full run', () => {
    const steps = gateSteps(['apps/mobile/src/a.ts'], workspace, 'main', { full: true });
    expect(steps.at(-1)?.args).toEqual([
      '--filter',
      '@zilar/mobile',
      'test',
      '--maxWorkers=2',
      '--changed',
      'main',
    ]);
  });

  it('finds no package for files outside every package', () => {
    expect(packagesTouched(['docs/a.md', 'work/T-1.md'], workspace)).toEqual([]);
  });
});

describe('strayFiles', () => {
  it('flags merge and patch leftovers only', () => {
    expect(strayFiles(['a/b.ts', 'a/b.ts.orig', 'c.rej', 'd.bak', 'origin.ts'])).toEqual([
      'a/b.ts.orig',
      'c.rej',
      'd.bak',
    ]);
  });
});
