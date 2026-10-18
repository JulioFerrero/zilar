// Which checks run for a set of changed files. Lint covers the repo, typecheck the
// packages, format the changed files, tests only the changed packages with the worker cap,
// and the server build when the server, a shared package or a manifest changes. By default
// only the nearest tests run: the changed test files plus each changed source's folder tests,
// and a few boot guards; `--full` lets Vitest pull in every test that imports the change.

import os from 'node:os';
import path from 'node:path';
import { isCountedSource } from '../effect-map/generate.js';

// Turbo's persistent cache, shared by every worktree.
export const turboCacheDir = path.join(os.homedir(), '.zilar-turbo-cache');

export interface WorkspacePackage {
  name: string;
  dir: string;
  hasTests: boolean;
}

export interface GateStep {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  skipReason?: string;
}

export interface GateOptions {
  full?: boolean;
  /** A merge gate must not reuse Turbo's cache. */
  merge?: boolean;
  cacheDir?: string;
  testFiles?: string[];
  exists?: (file: string) => boolean;
}

// No gate step may run forever: a hung test once sat inside `pnpm gate` for 50
// minutes. Tests get the longer limit.
export const TESTS_TIMEOUT_MS = 20 * 60 * 1000;
export const STEP_TIMEOUT_MS = 10 * 60 * 1000;

export function stepTimeoutMs(label: string): number {
  return label.startsWith('tests ') ? TESTS_TIMEOUT_MS : STEP_TIMEOUT_MS;
}

const TEST_FILE = /\.test\.tsx?$/;
const SOURCE_FILE = /\.tsx?$/;

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

export interface BootGuardTest {
  when: string;
  test: string;
}

// Tests that prove a package still boots, missed by the nearest-test search when the
// change is in another folder; each always runs when a source under its prefix changes.
export const BOOT_GUARD_TESTS: BootGuardTest[] = [
  { when: 'apps/server/src/', test: 'apps/server/src/actions/args-example.test.ts' },
];

function dirOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash);
}

function baseOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return file.slice(slash + 1);
}

// The nearest tests: the changed test files, plus for every changed `dir/name.ts(x)`
// the tests in `dir` named `name.*`; when none is named after it, every test directly
// in `dir` runs. `exists` skips a changed test file the branch deleted.
export function selectTestFiles(
  changedFiles: string[],
  testFiles: string[],
  exists: (file: string) => boolean = () => true,
): string[] {
  const selected = new Set<string>();
  for (const changed of changedFiles) {
    if (isTestFile(changed)) {
      if (exists(changed)) {
        selected.add(changed);
      }
      continue;
    }
    const source = SOURCE_FILE.exec(changed);
    if (source === null) {
      continue;
    }
    const dir = dirOf(changed);
    const base = baseOf(changed);
    const name = base.slice(0, base.length - source[0].length);
    const siblings = testFiles.filter((testFile) => dirOf(testFile) === dir);
    const named = siblings.filter((testFile) => baseOf(testFile).startsWith(`${name}.`));
    for (const testFile of named.length > 0 ? named : siblings) {
      selected.add(testFile);
    }
  }
  for (const guard of BOOT_GUARD_TESTS) {
    const sourceChanged = changedFiles.some(
      (file) => !isTestFile(file) && file.startsWith(guard.when),
    );
    if (sourceChanged && testFiles.includes(guard.test) && exists(guard.test)) {
      selected.add(guard.test);
    }
  }
  return [...selected].sort();
}

function inPackage(file: string, pkg: WorkspacePackage): boolean {
  return file === pkg.dir || file.startsWith(`${pkg.dir}/`);
}

export function packagesTouched(
  changedFiles: string[],
  workspace: WorkspacePackage[],
): WorkspacePackage[] {
  const found = new Map<string, WorkspacePackage>();
  for (const file of changedFiles) {
    for (const pkg of workspace) {
      if (inPackage(file, pkg)) {
        found.set(pkg.name, pkg);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function gateSteps(
  changedFiles: string[],
  workspace: WorkspacePackage[],
  base: string,
  options: GateOptions = {},
): GateStep[] {
  const full = options.full ?? false;
  const merge = options.merge ?? false;
  const cacheDir = options.cacheDir ?? turboCacheDir;
  const exists = options.exists ?? (() => true);
  const selected = full ? [] : selectTestFiles(changedFiles, options.testFiles ?? [], exists);
  const steps: GateStep[] = [
    { label: 'install (frozen)', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
    formatStep(changedFiles, full, exists),
    { label: 'lint', command: 'pnpm', args: ['lint'] },
    {
      label: 'typecheck',
      command: 'pnpm',
      args: [
        'exec',
        'turbo',
        'run',
        'typecheck',
        '--affected',
        '--concurrency=2',
        `--cache-dir=${cacheDir}`,
        ...(merge ? ['--force'] : []),
      ],
      env: { TURBO_SCM_BASE: base },
    },
    effectStep(changedFiles, base, exists),
    buildStep(changedFiles),
  ];
  for (const pkg of packagesTouched(changedFiles, workspace)) {
    if (!pkg.hasTests) {
      continue;
    }
    if (full) {
      steps.push({
        label: `tests ${pkg.name}`,
        command: 'pnpm',
        args: ['--filter', pkg.name, 'test', '--maxWorkers=2', '--changed', base],
      });
      continue;
    }
    const near = selected.filter((file) => inPackage(file, pkg));
    if (near.length === 0) {
      steps.push({
        label: `tests ${pkg.name}`,
        command: 'pnpm',
        args: [],
        skipReason: 'no nearby test files',
      });
      continue;
    }
    steps.push({
      label: `tests ${pkg.name}`,
      command: 'pnpm',
      args: [
        '--filter',
        pkg.name,
        'test',
        '--maxWorkers=2',
        ...near.map((file) => file.slice(pkg.dir.length + 1)),
      ],
    });
  }
  return steps;
}

// Format checks the changed files that still exist with Prettier directly; `--full`
// keeps the whole-repo check.
function formatStep(
  changedFiles: string[],
  full: boolean,
  exists: (file: string) => boolean,
): GateStep {
  if (full) {
    return { label: 'format', command: 'pnpm', args: ['format:check'] };
  }
  const present = changedFiles.filter(exists);
  if (present.length === 0) {
    return {
      label: 'format',
      command: 'pnpm',
      args: [],
      skipReason: 'no changed files',
    };
  }
  return {
    label: 'format',
    command: 'pnpm',
    args: ['exec', 'prettier', '--check', '--ignore-unknown', ...present],
  };
}

// The Effect ratchet checks the changed counted sources against the base.
function effectStep(
  changedFiles: string[],
  base: string,
  exists: (file: string) => boolean,
): GateStep {
  const sources = changedFiles.filter((file) => isCountedSource(file) && exists(file));
  if (sources.length === 0) {
    return {
      label: 'effect',
      command: 'pnpm',
      args: [],
      skipReason: 'no source files changed',
    };
  }
  return {
    label: 'effect',
    command: 'pnpm',
    args: [
      '--filter',
      '@zilar/devtools',
      'exec',
      'tsx',
      'src/effect-map/ratchet-cli.ts',
      '--base',
      base,
      ...sources,
    ],
  };
}

// The server production bundle, built as the deploy builds it: anything under the
// server, the shared packages or a manifest can break it.
function buildStep(changedFiles: string[]): GateStep {
  const needsBuild = changedFiles.some(
    (file) =>
      file.startsWith('apps/server/') ||
      file.startsWith('packages/') ||
      baseOf(file) === 'package.json',
  );
  if (!needsBuild) {
    return {
      label: 'build @zilar/server',
      command: 'pnpm',
      args: [],
      skipReason: 'no server, package or manifest change',
    };
  }
  return {
    label: 'build @zilar/server',
    command: 'pnpm',
    args: ['--filter', '@zilar/server', 'build'],
  };
}

export function strayFiles(trackedFiles: string[]): string[] {
  return trackedFiles.filter((file) => /\.(orig|rej|bak)$/.test(file));
}
