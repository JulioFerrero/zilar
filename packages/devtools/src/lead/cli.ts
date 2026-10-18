// The `lead` entry point: `main` and the entry check, invoked as
// `pnpm exec tsx src/lead/cli.ts <command>`.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alreadyPassedKey, gatePassDir, hasPassRecord, treeKey } from '../gate/pass-record.js';
import { runBatchCheck } from './batch/check.js';
import { runBatchMerge, type BatchMergeDeps } from './batch/merge.js';
import { isRecord } from './batch/parsers.js';
import type { BatchDeps, BatchPackage, CommandResult } from './batch/types.js';
import { runForget } from './forget.js';
import { RealGitRunner } from './git.js';
import { findTaskFile } from './launch.js';
import { mergeTask } from './merge.js';
import { findRepoRoot } from './repo-root.js';
import { runStatus } from './status.js';
import { stateFilePath, updateState } from './state.js';
import { parseTaskFrontMatter, taskFileDir } from './task-file.js';
import { runWatch, runWatchData } from './watch.js';
import { flagValue } from './cli/args.js';
import {
  runAutopilotCommand,
  runDoctor,
  runLaunch,
  runPrereview,
  runReply,
  runSnapshot,
  runSpecCheck,
  runSwitchModel,
} from './cli/commands.js';

const HELP = `lead — zero-token supervision of OpenCode workers

Usage: lead <command> [options]

  launch <T-XXXX> [--extra-rules <file>] [--base <ref>]      create the worktree and worker session (--base branches off an older commit)
  switch-model <T-XXXX> <provider/model> [--extra-rules <file>] [--in-place]
                                                            move a tracked worker onto a new model (quota fallback)
                                                            --in-place keeps the same session and its context; send lead reply after it if the worker is idle
  autopilot [--once] [--dry-run]                            watch sessions, answer permissions, nudge, pre-review
  doctor [--since <sha>]                                    audit main now with a Muse doctor session
  prereview <T-XXXX>                                        start a Muse pre-review manually
  reply <T-XXXX> <prompt-file> [--fresh]                   interrupt the worker and re-prompt it
  merge <T-XXXX> --summary "<one line>" [--skip-gate] [--hold]
                                                            rebase, run the gate, squash onto main, board, push, clean up
                                                            (--hold merges without pushing; run \`lead push\` to deploy)
                                                            ("T-XXXX: summary" is the commit subject, at most 72 characters)
  push                                                      push main to origin (deploys; use after \`lead merge --hold\`)
  batch check <T-A> <T-B> ...                               combine the branches on a wave worktree, run install, typecheck and every
                                                            package's tests, write one fix file per task under ~/.zilar-lead/wave/
  batch merge <T-A> <T-B> ...                               merge a checked wave task by task, no gate (refuses when the check is stale)
  spec-check <T-XXXX>                                    check a spec's paths, routes and web claims against the code
  snapshot                                                  JSON of every task in flight, its step and timings
  dashboard <out.html>                                      the snapshot rendered as the dashboard page
  status                                                    compact table of every tracked task
  forget <T-XXXX> [...] | --finished [--dry-run]            drop tracked tasks from the state file
  watch [--no-icons]                                          live terminal view of every running task

State lives outside the repo at ~/.zilar-lead/state.json (or ZILAR_LEAD_STATE).
Escalations print as one LEAD: line each on stdout; everything else goes to lead.log.
The autopilot never merges, pushes, or edits task files or the board.
`;

function runShell(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: `${Buffer.concat(chunks).toString('utf8')}\n${String(error)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

// The flags after `vitest run` in a package's test script (its own timeouts).
function testArgsOf(script: string): string[] {
  const match = /^\s*vitest run\s*(.*)$/.exec(script);
  return match === null ? [] : (match[1] as string).split(/\s+/).filter((arg) => arg.length > 0);
}

function readPackages(worktree: string): BatchPackage[] {
  const found: BatchPackage[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(worktree, group);
    if (!fs.existsSync(groupDir)) {
      continue;
    }
    for (const name of fs.readdirSync(groupDir)) {
      const manifest = path.join(groupDir, name, 'package.json');
      if (!fs.existsSync(manifest)) {
        continue;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (!isRecord(parsed) || typeof parsed['name'] !== 'string') {
        continue;
      }
      const scripts = isRecord(parsed['scripts']) ? parsed['scripts'] : {};
      const script = typeof scripts['test'] === 'string' ? scripts['test'] : undefined;
      found.push({
        name: parsed['name'],
        dir: `${group}/${name}`,
        testArgs: script === undefined ? undefined : testArgsOf(script),
      });
    }
  }
  return found;
}

function realBatchDeps(root: string): BatchDeps {
  return {
    root,
    git: new RealGitRunner(),
    runCommand: runShell,
    readText: (file) => fs.readFileSync(file, 'utf8'),
    writeText: (file, text) => fs.writeFileSync(file, text),
    makeDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    exists: (file) => fs.existsSync(file),
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    listPackages: readPackages,
    treeKey,
    now: () => new Date(),
    waveRoot: path.join(os.homedir(), '.zilar-lead', 'wave'),
    print: (line) => console.log(line),
  };
}

function realBatchMergeDeps(root: string): BatchMergeDeps {
  const base = realBatchDeps(root);
  const statePath = stateFilePath();
  return {
    root,
    git: base.git,
    readText: base.readText,
    exists: base.exists,
    listDir: base.listDir,
    waveRoot: base.waveRoot,
    print: base.print,
    mergeBase: {
      root,
      today: new Date().toISOString().slice(0, 10),
      runner: base.git,
      readText: base.readText,
      writeText: base.writeText,
      dropFromState: (entry) => {
        updateState(statePath, (state) => {
          delete state.tasks[entry];
        });
      },
    },
    merge: mergeTask,
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// The checks every merge must pass, run in the rebased worktree; the output tail is
// kept so the lead sees the failing step without rerunning. A pass record skips it.
function runGate(worktree: string): { ok: boolean; output: string } {
  const passedKey = alreadyPassedKey(worktree, {
    treeKey,
    hasRecord: (key) => hasPassRecord(gatePassDir, key),
  });
  if (passedKey !== undefined) {
    return {
      ok: true,
      output: `gate: skipped, this tree already passed (${passedKey.slice(0, 12)})`,
    };
  }
  const result = spawnSync('pnpm', ['gate', '--merge'], {
    cwd: worktree,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-45);
  return { ok: result.status === 0, output: output.join('\n') };
}

async function runMerge(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const summary = flagValue(args, '--summary');
  if (task === undefined || summary === undefined || summary.trim().length === 0) {
    throw new Error('usage: lead merge <T-XXXX> --summary "<one line, at most 72 characters>"');
  }
  const root = findRepoRoot();
  const statePath = stateFilePath();
  const worktree = path.join(path.dirname(path.resolve(root)), `zilar-${task}`);
  const dir = taskFileDir(root, task, statePath);
  const file = findTaskFile(dir, task);
  const frontMatter = parseTaskFrontMatter(fs.readFileSync(path.join(dir, 'work', file), 'utf8'));
  const held = args.includes('--hold');
  await mergeTask({
    root,
    task,
    file,
    worktree,
    branch: frontMatter.branch,
    summary,
    today: todayUtc(),
    runner: new RealGitRunner(),
    readText: (entry) => fs.readFileSync(entry, 'utf8'),
    writeText: (entry, text) => fs.writeFileSync(entry, text),
    ...(held ? { push: false } : {}),
    ...(args.includes('--skip-gate') ? {} : { gate: runGate }),
    dropFromState: (entry) => {
      updateState(statePath, (state) => {
        delete state.tasks[entry];
      });
    },
  });
  console.log(held ? `${task} merged (held: run \`lead push\` to deploy)` : `${task} merged`);
}

async function runPush(): Promise<void> {
  const root = findRepoRoot();
  const pushed = new RealGitRunner().run(root, ['push', '-q', 'origin', 'main']);
  if (!pushed.ok) {
    throw new Error('push of main failed');
  }
  console.log('main pushed');
}

async function runBatch(positional: string[]): Promise<void> {
  const [subcommand, ...tasks] = positional;
  const root = findRepoRoot();
  if (subcommand === 'check') {
    const result = await runBatchCheck(realBatchDeps(root), tasks);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } else if (subcommand === 'merge') {
    await runBatchMerge(realBatchMergeDeps(root), tasks);
  } else {
    throw new Error('usage: lead batch <check|merge> <T-XXXX> <T-XXXX> ...');
  }
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === 'launch') {
    await runLaunch(rest);
  } else if (command === 'switch-model') {
    await runSwitchModel(positional, rest);
  } else if (command === 'autopilot') {
    await runAutopilotCommand(positional, rest);
  } else if (command === 'doctor') {
    await runDoctor(positional, rest);
  } else if (command === 'prereview') {
    await runPrereview(positional);
  } else if (command === 'reply') {
    await runReply(positional, rest);
  } else if (command === 'snapshot') {
    await runSnapshot(positional, false);
  } else if (command === 'dashboard') {
    await runSnapshot(positional, true);
  } else if (command === 'spec-check') {
    runSpecCheck(positional);
  } else if (command === 'merge') {
    await runMerge(positional, rest);
  } else if (command === 'push') {
    await runPush();
  } else if (command === 'batch') {
    await runBatch(positional);
  } else if (command === 'forget') {
    await runForget(positional, rest);
  } else if (command === 'status') {
    await runStatus();
  } else if (command === 'watch') {
    if (rest.includes('--data')) {
      await runWatchData();
    } else {
      await runWatch({ noIcons: rest.includes('--no-icons') });
    }
  } else {
    throw new Error(`unknown command ${JSON.stringify(command)} (try: lead --help)`);
  }
}

const invoked = process.argv[1] !== undefined && process.argv[1].endsWith('cli.ts');
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`lead: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
