// Which checks the gate runs for a set of changed files. Lint and typecheck
// cover the whole repo (typecheck only the affected packages); format checks
// just the changed files unless `--full`; tests run only for the packages whose
// files changed, always with the worker cap. By default
// only the nearest tests run: the changed test files themselves plus, for each
// changed source file, the tests sitting in the same folder. `--full` keeps the
// older behaviour of letting Vitest pull in every test that imports the change.

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
  /** Extra environment variables for this step, merged over `process.env`. */
  env?: Record<string, string>;
  /** Set when there is nothing to run: the gate prints it and still passes. */
  skipReason?: string;
}

export interface GateOptions {
  /** Run each touched package's whole `--changed` set instead of the nearest tests. */
  full?: boolean;
  /** A merge gate must not reuse Turbo's cache: its typecheck runs with `--force`. */
  merge?: boolean;
  /** Turbo's persistent cache, shared by every worktree; defaults to `~/.zilar-turbo-cache`. */
  cacheDir?: string;
  /** Every test file in the repo, relative to the root; the near-test search space. */
  testFiles?: string[];
  /** Whether a changed path is still on disk; a deleted file must not be checked or run. */
  exists?: (file: string) => boolean;
}

// No gate step may run forever: a hung test once sat inside `pnpm gate` for
// 50 minutes before anyone noticed (2026-10-08). Tests get the longer limit.
export const TESTS_TIMEOUT_MS = 20 * 60 * 1000;
export const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// A step's time limit, chosen from its label: `tests …` gets the longer one.
export function stepTimeoutMs(label: string): number {
  return label.startsWith('tests ') ? TESTS_TIMEOUT_MS : STEP_TIMEOUT_MS;
}

const TEST_FILE = /\.test\.tsx?$/;
const SOURCE_FILE = /\.tsx?$/;

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

function dirOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash);
}

function baseOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return file.slice(slash + 1);
}

// The nearest tests for a set of changed files: the changed test files
// themselves, plus for every changed `dir/name.ts(x)` the tests in `dir` whose
// name starts with `name.` (so `service.ts` picks `service.test.ts` and
// `service.effect.test.ts`). When no test is named after the source file, every
// test sitting directly in `dir` is selected instead, so a file whose tests live
// under a different name (`roles/service.ts` and `roles/roles.test.ts`) still
// gets its folder's tests; tests in subfolders are not. A folder with no tests
// selects nothing. `exists` guards against a changed test file the branch
// deleted: it is still in the diff but must not be handed to Vitest, which would
// fail on a missing file.
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

// The format step: the changed files that still exist, checked with Prettier
// directly. `--full` keeps the whole-repo check. Nothing changed means nothing
// to check, so the step is skipped rather than checking the whole repo.
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

// The Effect ratchet (task R6): the changed counted sources that still exist are
// checked against the base, so a new or regressed needs-effect file fails. Skipped
// when no existing changed file is a counted source. Runs in devtools, which is
// exempt, so the step's own files never trip it.
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

// Merge and patch leftovers that must never be committed.
export function strayFiles(trackedFiles: string[]): string[] {
  return trackedFiles.filter((file) => /\.(orig|rej|bak)$/.test(file));
}
