// `pnpm gate` runs the checks a task must pass before it can go to review (and
// that `lead merge` runs again after the rebase): install, format, lint,
// typecheck, the nearest tests of every package the branch touched, and a scope
// report of files changed outside the task's "Allowed files". By default only
// the changed test files and the tests next to each changed source file run;
// `--full` lets Vitest pull in every test that imports the changes instead. It
// prints one summary line per step and ends with `GATE PASS` or `GATE FAIL`.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  gateSteps,
  isTestFile,
  stepTimeoutMs,
  strayFiles,
  type GateStep,
  type WorkspacePackage,
} from './plan.js';
import { scopeReport } from './scope.js';

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

function run(cwd: string, command: string, args: string[], timeoutMs?: number): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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

function main(): void {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? (args[baseIndex + 1] ?? 'main') : 'main';
  const full = args.includes('--full');
  const root = run(process.cwd(), 'git', ['rev-parse', '--show-toplevel']).output.trim();
  const files = changedFiles(root, base);
  const tracked = lines(run(root, 'git', ['ls-files']).output);
  const steps: GateStep[] = gateSteps(files, readWorkspace(root), base, {
    full,
    testFiles: tracked.filter(isTestFile),
    exists: (file) => fs.existsSync(path.join(root, file)),
  });
  let failed = false;
  console.log(`gate: ${files.length} changed file(s) against ${base}${full ? ' (full)' : ''}`);
  for (const step of steps) {
    if (step.skipReason !== undefined) {
      console.log(`SKIP ${step.label} (${step.skipReason})`);
      continue;
    }
    const timeoutMs = stepTimeoutMs(step.label);
    const started = Date.now();
    const result = run(root, step.command, step.args, timeoutMs);
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
  console.log(failed ? 'GATE FAIL' : 'GATE PASS');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
