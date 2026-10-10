import { describe, expect, it } from 'vitest';
import {
  gateSteps,
  packagesTouched,
  selectTestFiles,
  stepTimeoutMs,
  strayFiles,
  STEP_TIMEOUT_MS,
  TESTS_TIMEOUT_MS,
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

  it('lets `**/` match zero folders', () => {
    const matcher = tokenMatcher('apps/web/src/**/*.test.tsx');
    expect(matcher.test('apps/web/src/App.test.tsx')).toBe(true);
    expect(matcher.test('apps/web/src/a/b/C.test.tsx')).toBe(true);
    expect(matcher.test('apps/web/src/App.tsx')).toBe(false);
    expect(tokenMatcher('a/**/b.ts').test('a/b.ts')).toBe(true);
    expect(tokenMatcher('a/**/b.ts').test('a/x/y/b.ts')).toBe(true);
    expect(tokenMatcher('a/**/b.ts').test('ab.ts')).toBe(false);
  });

  it('matches a leading `**/` from the root or below', () => {
    expect(tokenMatcher('**/b.ts').test('b.ts')).toBe(true);
    expect(tokenMatcher('**/b.ts').test('x/y/b.ts')).toBe(true);
    expect(tokenMatcher('**/b.ts').test('x/b.tsx')).toBe(false);
  });

  it('keeps `a/*.ts` inside one folder and `a/b/**` below it', () => {
    expect(tokenMatcher('a/*.ts').test('a/c.ts')).toBe(true);
    expect(tokenMatcher('a/*.ts').test('a/x/c.ts')).toBe(false);
    expect(tokenMatcher('a/b/**').test('a/b/x/y.ts')).toBe(true);
    expect(tokenMatcher('a/b/**').test('a/c.ts')).toBe(false);
  });

  it('treats brackets and question marks in paths as literal text', () => {
    expect(tokenMatcher('apps/mobile/src/app/chat/[id].tsx').test('apps/mobile/src/app/chat/[id].tsx')).toBe(true);
    expect(tokenMatcher('apps/mobile/src/app/chat/[id].tsx').test('apps/mobile/src/app/chat/i.tsx')).toBe(false);
    expect(tokenMatcher('a/what?.ts').test('a/what?.ts')).toBe(true);
    expect(tokenMatcher('a/what?.ts').test('a/whats.ts')).toBe(false);
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

  it('falls back to the tests directly in the source file folder', () => {
    expect(selectTestFiles(['packages/a/src/lonely.ts'], testFiles)).toEqual([
      'packages/a/src/other.test.ts',
      'packages/a/src/service.effect.test.ts',
      'packages/a/src/service.test.ts',
    ]);
  });

  it('still selects nothing for a source file in a folder with no tests', () => {
    expect(selectTestFiles(['packages/a/src/empty/x.ts'], testFiles)).toEqual([]);
  });

  it('does not pick tests from a subfolder for the folder fallback', () => {
    expect(selectTestFiles(['packages/a/src/lonely.ts'], testFiles)).not.toContain(
      'packages/a/src/nested/deep.test.ts',
    );
  });

  it('ignores a non-code file', () => {
    expect(selectTestFiles(['packages/a/readme.md'], testFiles)).toEqual([]);
  });
});

describe('gateSteps', () => {
  it('runs install, format, lint, typecheck and the effect ratchet, then only the nearest tests', () => {
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
      'effect',
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

  it('formats only the changed files that still exist', () => {
    const steps = gateSteps(
      ['apps/mobile/src/a.ts', 'apps/mobile/src/gone.ts', 'work/T-1.md'],
      workspace,
      'main',
      { exists: (file) => file !== 'apps/mobile/src/gone.ts' },
    );
    expect(steps.find((step) => step.label === 'format')).toEqual({
      label: 'format',
      command: 'pnpm',
      args: [
        'exec',
        'prettier',
        '--check',
        '--ignore-unknown',
        'apps/mobile/src/a.ts',
        'work/T-1.md',
      ],
    });
  });

  it('skips the format step when no changed file is left', () => {
    const steps = gateSteps(['apps/mobile/src/gone.ts'], workspace, 'main', {
      exists: () => false,
    });
    expect(steps.find((step) => step.label === 'format')).toMatchObject({
      label: 'format',
      skipReason: 'no changed files',
    });
  });

  it('keeps the whole-repo format check for the full run', () => {
    const steps = gateSteps(['apps/mobile/src/a.ts'], workspace, 'main', { full: true });
    expect(steps.find((step) => step.label === 'format')?.args).toEqual(['format:check']);
  });

  it('typechecks only the affected packages with one shared cache', () => {
    const typecheck = gateSteps(['apps/mobile/src/a.ts'], workspace, 'main', {
      testFiles: ['apps/mobile/src/a.test.ts'],
      cacheDir: '/tmp/zilar-turbo-cache',
    }).find((step) => step.label === 'typecheck');
    expect(typecheck?.args).toEqual([
      'exec',
      'turbo',
      'run',
      'typecheck',
      '--affected',
      '--concurrency=2',
      '--cache-dir=/tmp/zilar-turbo-cache',
    ]);
    expect(typecheck?.env).toEqual({ TURBO_SCM_BASE: 'main' });
  });

  it('forces a merge gate past Turbo cache', () => {
    const typecheck = gateSteps(['apps/mobile/src/a.ts'], workspace, 'main', {
      merge: true,
      cacheDir: '/tmp/zilar-turbo-cache',
    }).find((step) => step.label === 'typecheck');
    expect(typecheck?.args.at(-1)).toBe('--force');
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
    expect(steps.slice(5).map((step) => step.label)).toEqual([
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

describe('effect ratchet step', () => {
  const effectOf = (changed: string[], exists?: (file: string) => boolean) =>
    gateSteps(changed, workspace, 'main', exists === undefined ? {} : { exists }).find(
      (step) => step.label === 'effect',
    );

  it('checks the existing changed counted sources against the base, with the devtools tsx', () => {
    expect(
      effectOf(
        ['apps/server/src/a.ts', 'apps/server/src/gone.ts', 'work/T-1.md'],
        (file) => file !== 'apps/server/src/gone.ts',
      ),
    ).toEqual({
      label: 'effect',
      command: 'pnpm',
      args: [
        '--filter',
        '@zilar/devtools',
        'exec',
        'tsx',
        'src/effect-map/ratchet-cli.ts',
        '--base',
        'main',
        'apps/server/src/a.ts',
      ],
    });
  });

  it('skips when no changed file is a counted source (a task file, a doc, a test)', () => {
    expect(effectOf(['work/T-1.md', 'docs/a.md', 'apps/server/src/a.test.ts'])).toMatchObject({
      label: 'effect',
      skipReason: 'no source files changed',
    });
  });

  it('skips when the only counted source was deleted on the branch', () => {
    expect(effectOf(['apps/server/src/gone.ts'], () => false)).toMatchObject({
      label: 'effect',
      skipReason: 'no source files changed',
    });
  });
});

describe('stepTimeoutMs', () => {
  it('gives test steps 20 minutes and every other step 10', () => {
    expect(stepTimeoutMs('tests @zilar/mobile')).toBe(20 * 60 * 1000);
    expect(stepTimeoutMs('tests @zilar/server')).toBe(TESTS_TIMEOUT_MS);
    expect(stepTimeoutMs('install (frozen)')).toBe(10 * 60 * 1000);
    expect(stepTimeoutMs('format')).toBe(STEP_TIMEOUT_MS);
    expect(stepTimeoutMs('lint')).toBe(STEP_TIMEOUT_MS);
    expect(stepTimeoutMs('typecheck')).toBe(STEP_TIMEOUT_MS);
  });

  it('only the `tests ` prefix gets the longer limit', () => {
    expect(stepTimeoutMs('testsuite')).toBe(STEP_TIMEOUT_MS);
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
