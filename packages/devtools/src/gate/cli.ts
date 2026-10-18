// `pnpm gate` runs install, format, lint, typecheck, the nearest tests of every
// touched package and a scope report of files outside the task's "Allowed files".
// It prints one summary line per step and ends with `GATE PASS` or `GATE FAIL`;
// a pass writes a record so `lead merge` can skip re-running on the same tree.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  gateSteps,
  isTestFile,
  stepTimeoutMs,
  strayFiles,
  turboCacheDir,
  type GateStep,
  type WorkspacePackage,
} from './plan.js';
import { gatePassDir, treeKey, writePassRecord } from './pass-record.js';
import {
  checkMigrations,
  migrationNumber,
  parseMigrationDiff,
  type MigrationDiff,
} from './migrations.js';
import { checkImages } from './images.js';
import { scopeReport } from './scope.js';
import { countLines, isSizeChecked, sizeViolations, type SizeFile } from './size.js';
import { gateSlotsDir, release, tryAcquire } from './slots.js';

interface RunResult {
  ok: boolean;
  /** True when `timeoutMs` stopped the command; the caller reports `timed out`. */
  timedOut: boolean;
  output: string;
}

// `spawnSync` reports a timeout as an Error carrying an errno-style `code`,
// which the base `Error` type doesn't declare.
function hasErrorCode(error: Error | undefined, code: string): boolean {
  return error !== undefined && 'code' in error && error.code === code;
}

function run(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs?: number,
  env?: Record<string, string>,
): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
    ...(timeoutMs === undefined
      ? {}
      : { timeout: timeoutMs, killSignal: 'SIGKILL' as const, detached: true }),
  });
  const timedOut = timeoutMs !== undefined && hasErrorCode(result.error, 'ETIMEDOUT');
  if (timedOut && result.pid !== undefined) {
    // `detached` made the child a process-group leader. Killing the group, not
    // just the direct child, keeps a timed-out Vitest from leaving grandchildren.
    try {
      process.kill(-result.pid, 'SIGKILL');
    } catch {
      // The group is already gone.
    }
  }
  return {
    ok: result.status === 0,
    timedOut,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function changedFiles(root: string, base: string): string[] {
  const committed = lines(run(root, 'git', ['diff', '--name-only', `${base}...HEAD`]).output);
  const uncommitted = lines(run(root, 'git', ['diff', '--name-only', 'HEAD']).output);
  const untracked = lines(run(root, 'git', ['ls-files', '--others', '--exclude-standard']).output);
  return [...new Set([...committed, ...uncommitted, ...untracked])].sort();
}

// Added and modified migrations in the diff against the base: `--name-status`
// keeps the distinction and a rename lands at a new path, which counts as added.
function migrationDiff(root: string, base: string): MigrationDiff {
  const committed = run(root, 'git', ['diff', '--name-status', `${base}...HEAD`]).output;
  const uncommitted = run(root, 'git', ['diff', '--name-status', 'HEAD']).output;
  const untracked = lines(run(root, 'git', ['ls-files', '--others', '--exclude-standard']).output)
    .map((file) => `A\t${file}`)
    .join('\n');
  return parseMigrationDiff([committed, uncommitted, untracked].join('\n'));
}

// The highest migration number on the base branch.
function baseMigrationMax(root: string, base: string): number {
  const tree = run(root, 'git', [
    'ls-tree',
    '-r',
    '--name-only',
    base,
    '--',
    'apps/server/drizzle',
  ]).output;
  let max = 0;
  for (const file of lines(tree)) {
    const number = migrationNumber(file);
    if (number !== undefined && number > max) {
      max = number;
    }
  }
  return max;
}

function baseLineCount(root: string, base: string, file: string): number | null {
  const result = run(root, 'git', ['show', `${base}:${file}`]);
  return result.ok ? countLines(result.output) : null;
}

// Each changed source file must stay within 400 lines unless the base was already
// over and the branch did not grow it.
function sizeReport(root: string, base: string, files: string[]): string[] {
  const inputs: SizeFile[] = [];
  for (const file of files) {
    if (!isSizeChecked(file)) continue;
    const onDisk = path.join(root, file);
    inputs.push({
      path: file,
      lines: fs.existsSync(onDisk) ? countLines(fs.readFileSync(onDisk, 'utf8')) : null,
      baseLines: baseLineCount(root, base, file),
    });
  }
  return sizeViolations(inputs);
}

export function readWorkspace(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(root, group);
    if (!fs.existsSync(groupDir)) {
      continue;
    }
    for (const name of fs.readdirSync(groupDir)) {
      const manifest = path.join(groupDir, name, 'package.json');
      if (!fs.existsSync(manifest)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      if (typeof parsed.name === 'string') {
        found.push({
          name: parsed.name,
          dir: `${group}/${name}`,
          hasTests: parsed.scripts?.['test'] !== undefined,
        });
      }
    }
  }
  return found;
}

function taskTextFor(root: string): string | undefined {
  const branch = run(root, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']).output.trim();
  const id = /^task\/(T-\d+)/.exec(branch)?.[1];
  if (id === undefined) {
    return undefined;
  }
  const workDir = path.join(root, 'work');
  const file = fs.readdirSync(workDir).find((name) => name.startsWith(`${id}-`));
  return file === undefined ? undefined : fs.readFileSync(path.join(workDir, file), 'utf8');
}

function tail(text: string, count: number): string {
  return lines(text).slice(-count).join('\n');
}

const SLOT_POLL_MS = 5000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireSlot(names: string[]): string | undefined {
  let slot = tryAcquire(gateSlotsDir, names);
  if (slot === undefined) {
    console.log('gate: waiting for a free gate slot');
    while (slot === undefined) {
      sleepSync(SLOT_POLL_MS);
      slot = tryAcquire(gateSlotsDir, names);
    }
  }
  return slot;
}

function main(): void {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? (args[baseIndex + 1] ?? 'main') : 'main';
  const full = args.includes('--full');
  const merge = args.includes('--merge');
  const root = run(process.cwd(), 'git', ['rev-parse', '--show-toplevel']).output.trim();
  const files = changedFiles(root, base);
  // Hashed before any step runs, so the record names the tree the steps checked.
  const passKey = treeKey(root);
  const tracked = lines(run(root, 'git', ['ls-files']).output);
  const steps: GateStep[] = gateSteps(files, readWorkspace(root), base, {
    full,
    merge,
    cacheDir: turboCacheDir,
    testFiles: tracked.filter(isTestFile),
    exists: (file) => fs.existsSync(path.join(root, file)),
  });
  const slot = acquireSlot(merge ? ['merge'] : ['w1', 'w2']);
  const releaseSlot = (): void => {
    if (slot !== undefined) {
      release(gateSlotsDir, slot);
    }
  };
  // A signal must free the slot too, or the next gate waits on a dead pid.
  process.once('SIGINT', () => {
    releaseSlot();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    releaseSlot();
    process.exit(143);
  });
  let failed = false;
  console.log(
    `gate: ${files.length} changed file(s) against ${base}${full ? ' (full)' : ''}${merge ? ' (merge)' : ''}`,
  );
  try {
    for (const step of steps) {
      if (step.skipReason !== undefined) {
        console.log(`SKIP ${step.label} (${step.skipReason})`);
        continue;
      }
      const timeoutMs = stepTimeoutMs(step.label);
      const started = Date.now();
      const command = merge ? step.command : 'nice';
      const commandArgs = merge ? step.args : ['-n', '10', step.command, ...step.args];
      const result = run(root, command, commandArgs, timeoutMs, step.env);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (result.timedOut) {
        failed = true;
        console.log(`FAIL  ${step.label}  (timed out after ${timeoutMs / 60_000} min)`);
        console.log(tail(result.output, 40));
        break;
      }
      console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${step.label}  (${seconds}s)`);
      if (!result.ok) {
        failed = true;
        console.log(tail(result.output, 40));
        break;
      }
    }
    const stray = strayFiles(tracked);
    if (stray.length > 0) {
      failed = true;
      console.log(`FAIL  stray merge leftovers are tracked: ${stray.join(', ')}`);
    }
    const taskText = taskTextFor(root);
    if (taskText !== undefined) {
      const scope = scopeReport(taskText, files);
      if (scope.unchecked) {
        console.log('scope: the task names no Allowed files, nothing to compare');
      } else if (scope.outside.length === 0) {
        console.log('scope: every changed file is inside the Allowed files');
      } else {
        console.log(`scope: ${scope.outside.length} file(s) outside the Allowed files:`);
        for (const file of scope.outside) {
          console.log(`  ${file}`);
        }
      }
    }
    const migration = checkMigrations(migrationDiff(root, base), baseMigrationMax(root, base));
    for (const warning of migration.warnings) {
      console.log(`WARN  ${warning}`);
    }
    if (migration.failures.length === 0) {
      console.log('migration: every added migration continues from the base');
    } else {
      failed = true;
      console.log(`FAIL  migrations: ${migration.failures.length} added file(s) out of sequence`);
      for (const failure of migration.failures) {
        console.log(`  ${failure}`);
      }
    }
    const imageFailures = checkImages(readWorkspace(root), (file) =>
      fs.readFileSync(path.join(root, file), 'utf8'),
    );
    if (imageFailures.length === 0) {
      console.log(
        'images: every workspace package an app image needs is copied into its Dockerfile',
      );
    } else {
      failed = true;
      console.log(
        `FAIL  images: ${imageFailures.length} workspace package(s) missing from a Dockerfile`,
      );
      for (const failure of imageFailures) {
        console.log(`  ${failure}`);
      }
    }
    const sizeFailures = sizeReport(root, base, files);
    if (sizeFailures.length === 0) {
      console.log('size: every changed source file is within 400 lines');
    } else {
      failed = true;
      console.log(`FAIL  size: ${sizeFailures.length} changed source file(s) over 400 lines`);
      for (const failure of sizeFailures) {
        console.log(`  ${failure}`);
      }
    }
  } finally {
    releaseSlot();
  }
  if (!failed && passKey !== undefined) {
    writePassRecord(gatePassDir, passKey);
  }
  console.log(failed ? 'GATE FAIL' : 'GATE PASS');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
