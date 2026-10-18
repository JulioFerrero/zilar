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
import { scopeReport } from './scope.js';
import { countLines, isSizeChecked, sizeViolations, sizeWarnings, type SizeFile } from './size.js';
import { gateSlotsDir, release, tryAcquire } from './slots.js';

// Added comment lines that cite a task ID: the task file and the commit already
// carry that history. Pure: the caller passes `git diff -U0 <base> -- apps packages`.

const TASK_ID = /\bT-\d{3,4}\b/;
const COMMENT_PREFIXES: readonly string[] = ['//', '/*', '*', '{/*'];

function isComment(line: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

export function taskIdComments(diff: string): string[] {
  const hits: string[] = [];
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const header = line.slice(4);
      file = header === '/dev/null' ? null : header.replace(/^b\//, '');
      continue;
    }
    if (file === null || !line.startsWith('+')) continue;
    const text = line.slice(1).trim();
    if (text.length === 0 || !isComment(text) || !TASK_ID.test(text)) continue;
    if (!isSizeChecked(file)) continue;
    hits.push(`${file}: ${text}`);
  }
  return hits;
}

// The migrator skips every id at or below the latest applied one, so a migration
// numbered below the tip that merges late never runs. A new
// `apps/server/drizzle/NNNN_*.sql` must continue from the highest number on the base
// branch; editing an existing one is only a warning.

const MIGRATION_FILE = /^apps\/server\/drizzle\/(\d+)_[^/]*\.sql$/;

interface MigrationDiff {
  added: string[];
  modified: string[];
}

interface MigrationCheckReport {
  failures: string[];
  warnings: string[];
}

export function migrationNumber(file: string): number | undefined {
  const match = MIGRATION_FILE.exec(file);
  return match === null ? undefined : Number(match[1]);
}

function fourDigits(number: number): string {
  return String(number).padStart(4, '0');
}

// A rename or copy line carries two paths (`R100\told\tnew`) and lands at a new
// path, so its destination counts as added: a migration introduced by rename must
// still pass the sequence check.
export function parseMigrationDiff(text: string): MigrationDiff {
  const added = new Set<string>();
  const modified = new Set<string>();
  for (const line of text.split('\n')) {
    const [status = '', first = '', second = ''] = line.split('\t');
    if (status === 'A') {
      added.add(first);
    } else if (status === 'M') {
      modified.add(first);
    } else if (status.startsWith('R') || status.startsWith('C')) {
      added.add(second);
    }
  }
  return { added: [...added].sort(), modified: [...modified].sort() };
}

export function checkMigrations(diff: MigrationDiff, baseMax: number): MigrationCheckReport {
  const failures: string[] = [];
  const added = diff.added
    .flatMap((file) => {
      const number = migrationNumber(file);
      return number === undefined ? [] : [{ file, number }];
    })
    .sort((left, right) => left.number - right.number);
  for (const [index, entry] of added.entries()) {
    const expected = baseMax + 1 + index;
    if (entry.number !== expected) {
      failures.push(
        `${entry.file}: expected ${fourDigits(expected)}, found ${fourDigits(entry.number)}`,
      );
    }
  }
  const warnings: string[] = [];
  for (const file of diff.modified) {
    if (migrationNumber(file) !== undefined) {
      warnings.push(
        `${file} is an existing migration; editing it does not run once it is journaled`,
      );
    }
  }
  return { failures, warnings };
}

// A production image copies only the workspace packages its Dockerfile names by hand.
// This compares, as plain text and without Docker, the `@zilar/*` workspace deps of
// an app with the `COPY packages/<name>` lines of its Dockerfile.

interface ImageTarget {
  app: string;
  manifest: string;
  dockerfile: string;
}

const IMAGE_TARGETS: readonly ImageTarget[] = [
  {
    app: 'apps/server',
    manifest: 'apps/server/package.json',
    dockerfile: 'apps/server/Dockerfile',
  },
  { app: 'apps/web', manifest: 'apps/web/package.json', dockerfile: 'apps/web/Dockerfile' },
];

// The web app reaches @zilar/mock-backend only through the VITE_MOCK branch Vite
// folds out of a production build, so its image does not copy it.
const NOT_IN_IMAGE = new Set(['@zilar/mock-backend']);

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function workspaceDeps(manifest: string): string[] {
  const parsed = JSON.parse(manifest) as Manifest;
  const names: string[] = [];
  for (const block of [parsed.dependencies, parsed.devDependencies]) {
    for (const [name, range] of Object.entries(block ?? {})) {
      if (name.startsWith('@zilar/') && range.startsWith('workspace:')) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)].sort();
}

// The `packages/<name>` directories a Dockerfile copies whole; a manifest copy
// (`COPY packages/desk/package.json ...`) names a nested path and is skipped.
export function copiedPackageDirs(dockerfile: string): Set<string> {
  const dirs = new Set<string>();
  for (const line of dockerfile.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'COPY') {
      continue;
    }
    const source = parts.slice(1).filter((part) => !part.startsWith('--'))[0];
    if (source !== undefined && /^packages\/[^/]+$/.test(source)) {
      dirs.add(source);
    }
  }
  return dirs;
}

function packageDirFor(name: string, workspace: WorkspacePackage[]): string {
  return (
    workspace.find((pkg) => pkg.name === name)?.dir ?? `packages/${name.slice('@zilar/'.length)}`
  );
}

interface ImageCheckInput {
  app: string;
  manifest: string;
  dockerfile: string;
  workspace: WorkspacePackage[];
}

export function checkImagePackages(input: ImageCheckInput): string[] {
  const copied = copiedPackageDirs(input.dockerfile);
  const failures: string[] = [];
  for (const name of workspaceDeps(input.manifest)) {
    if (NOT_IN_IMAGE.has(name)) {
      continue;
    }
    const dir = packageDirFor(name, input.workspace);
    if (!copied.has(dir)) {
      failures.push(`${input.app}/Dockerfile: missing \`COPY ${dir} ${dir}\` for ${name}`);
    }
  }
  return failures;
}

export function checkImages(
  workspace: WorkspacePackage[],
  read: (file: string) => string,
): string[] {
  const failures: string[] = [];
  for (const target of IMAGE_TARGETS) {
    try {
      failures.push(
        ...checkImagePackages({
          app: target.app,
          manifest: read(target.manifest),
          dockerfile: read(target.dockerfile),
          workspace,
        }),
      );
    } catch {
      failures.push(`${target.dockerfile}: cannot read ${target.manifest} or the Dockerfile`);
    }
  }
  return failures;
}

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

interface SizeReport {
  warnings: string[];
  failures: string[];
}

// Each changed source file warns over the soft limit of 400 lines and must stay
// within 800 unless the base was already over and the branch did not grow it.
function sizeReport(root: string, base: string, files: string[]): SizeReport {
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
  return { warnings: sizeWarnings(inputs), failures: sizeViolations(inputs) };
}

// Added comment lines in source files that cite a task ID. Diffing from the
// merge base keeps lines that other merged tasks removed on the base out of the
// additions.
function commentReport(root: string, base: string): string[] {
  const mergeBase = run(root, 'git', ['merge-base', base, 'HEAD']).output.trim();
  const diff = run(root, 'git', ['diff', '-U0', mergeBase, '--', 'apps', 'packages']).output;
  return taskIdComments(diff);
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
    const size = sizeReport(root, base, files);
    for (const warning of size.warnings) {
      console.log(
        `WARN  size: ${warning} (soft limit 400; fine when keeping the file whole saves lines)`,
      );
    }
    if (size.failures.length === 0) {
      console.log('size: no changed source file is over 800 lines');
    } else {
      failed = true;
      console.log(`FAIL  size: ${size.failures.length} changed source file(s) over 800 lines`);
      for (const failure of size.failures) {
        console.log(`  ${failure}`);
      }
    }
    const commentHits = commentReport(root, base);
    if (commentHits.length === 0) {
      console.log('comments: no task IDs in added comments');
    } else {
      failed = true;
      console.log(
        `FAIL  comments: ${commentHits.length} added comment line(s) cite a task ID (docs/COMMENTS.md)`,
      );
      for (const hit of commentHits) {
        console.log(`  ${hit}`);
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
