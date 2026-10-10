import type { GitRunner } from '../git.js';

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchError';
  }
}

export interface CommandResult {
  status: number;
  /** stdout and stderr together. */
  output: string;
}

export interface BatchPackage {
  name: string;
  /** Repo-relative folder, such as `apps/web`. */
  dir: string;
  /** Arguments after `vitest run` in the package's test script; undefined when it has no tests. */
  testArgs: string[] | undefined;
}

export interface BatchDeps {
  /** The main checkout. */
  root: string;
  git: GitRunner;
  runCommand: (
    cwd: string,
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<CommandResult>;
  readText: (file: string) => string;
  writeText: (file: string, text: string) => void;
  makeDir: (dir: string) => void;
  exists: (file: string) => boolean;
  listDir: (dir: string) => string[];
  listPackages: (worktree: string) => BatchPackage[];
  treeKey: (worktree: string) => string | undefined;
  now: () => Date;
  /** Where waves are written: `~/.zilar-lead/wave`. */
  waveRoot: string;
  print: (line: string) => void;
}

export interface Failure {
  kind: 'typecheck' | 'lint' | 'format' | 'test' | 'tool';
  /** Repo-relative file, when the failure names one. */
  file?: string;
  /** The test's full name, the TS error code or the failing step. */
  name: string;
  message: string;
}

export interface TaskOutcome {
  task: string;
  branch: string;
  head: string;
  merged: boolean;
  conflictFiles: string[];
  conflictNote: string;
  files: string[];
  outside: string[];
  failures: Failure[];
}

export interface CheckResult {
  ok: boolean;
  waveDir: string;
  reportPath: string;
  lines: string[];
}

export interface LastWave {
  createdAt: string;
  dir: string;
  tasks: string[];
  heads: Record<string, { branch: string; head: string }>;
  wave: string;
  treeKey: string | null;
  ok: boolean;
}
