// Which checks the gate runs for a set of changed files. The whole repo always
// gets format, lint and typecheck (they are fast and global); tests run only
// for the packages whose files changed, always with the worker cap. By default
// only the nearest tests run: the changed test files themselves plus, for each
// changed source file, the tests sitting in the same folder. `--full` keeps the
// older behaviour of letting Vitest pull in every test that imports the change.

export interface WorkspacePackage {
  name: string;
  dir: string;
  hasTests: boolean;
}

export interface GateStep {
  label: string;
  command: string;
  args: string[];
  /** Set when there is nothing to run: the gate prints it and still passes. */
  skipReason?: string;
}

export interface GateOptions {
  /** Run each touched package's whole `--changed` set instead of the nearest tests. */
  full?: boolean;
  /** Every test file in the repo, relative to the root; the near-test search space. */
  testFiles?: string[];
  /** Whether a selected path is still on disk; a deleted test must not be run. */
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

// The nearest tests for a set of changed files: the changed test files
// themselves, plus for every changed `dir/name.ts(x)` the tests in `dir` whose
// name starts with `name.` (so `service.ts` picks `service.test.ts` and
// `service.effect.test.ts`). A source file with no sibling test selects none.
// `exists` guards against a changed test file the branch deleted: it is still in
// the diff but must not be handed to Vitest, which would fail on a missing file.
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
    const slash = changed.lastIndexOf('/');
    const dir = slash < 0 ? '' : changed.slice(0, slash);
    const name = changed.slice(slash + 1, changed.length - source[0].length);
    for (const testFile of testFiles) {
      const testSlash = testFile.lastIndexOf('/');
      const testDir = testSlash < 0 ? '' : testFile.slice(0, testSlash);
      const testName = testFile.slice(testSlash + 1);
      if (testDir === dir && testName.startsWith(`${name}.`)) {
        selected.add(testFile);
      }
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
  const selected = full
    ? []
    : selectTestFiles(changedFiles, options.testFiles ?? [], options.exists);
  const steps: GateStep[] = [
    { label: 'install (frozen)', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
    { label: 'format', command: 'pnpm', args: ['format:check'] },
    { label: 'lint', command: 'pnpm', args: ['lint'] },
    { label: 'typecheck', command: 'pnpm', args: ['typecheck'] },
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

// Merge and patch leftovers that must never be committed.
export function strayFiles(trackedFiles: string[]): string[] {
  return trackedFiles.filter((file) => /\.(orig|rej|bak)$/.test(file));
}
