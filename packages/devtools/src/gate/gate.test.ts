import { describe, expect, it } from 'vitest';
import { gateSteps, packagesTouched, type WorkspacePackage } from './plan.js';
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

describe('gateSteps', () => {
  it('always runs install, format, lint and typecheck, then only the touched packages', () => {
    const steps = gateSteps(['apps/mobile/src/a.ts', 'packages/docs/readme.md'], workspace, 'main');
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
      '--changed',
      'main',
    ]);
  });

  it('finds no package for files outside every package', () => {
    expect(packagesTouched(['docs/a.md', 'work/T-1.md'], workspace)).toEqual([]);
  });
});
