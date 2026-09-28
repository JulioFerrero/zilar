import fs from 'node:fs';
import path from 'node:path';
import { runAutopilot, type AutopilotDeps } from './autopilot.js';
import { OpencodeCliClient } from './client.js';
import { RealGitRunner } from './git.js';
import { findTaskFile, launchTask } from './launch.js';
import { mergeTask } from './merge.js';
import { promptsDir } from './prompts.js';
import { replyToWorker } from './reply.js';
import { startPrereviewSession } from './start-prereview.js';
import { collectStatus, formatStatus } from './status.js';
import { currentHead } from './git.js';
import { loadState, saveState, stateFilePath } from './state.js';
import { parseTaskFrontMatter } from './task-file.js';

const HELP = `lead — zero-token supervision of OpenCode workers

Usage: lead <command> [options]

  launch <T-XXXX> [--extra-rules <file>]  create the worktree and worker session
  autopilot [--once] [--dry-run]          watch sessions, answer permissions, nudge, pre-review
  prereview <T-XXXX>                      start a Muse pre-review manually
  reply <T-XXXX> <prompt-file>            interrupt the worker and re-prompt it
  merge <T-XXXX> --summary "<one line>"   rebase, fast-forward main, board, push, clean up
  status                                  compact table of every tracked task

State lives outside the repo at ~/.galena-lead/state.json (or GALENA_LEAD_STATE).
Escalations print as one LEAD: line each on stdout; everything else goes to lead.log.
The autopilot never merges, pushes, or edits task files or the board.
`;

// Walks up from the cwd to the checkout holding work/BOARD.md.
function findRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'work', 'BOARD.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('not inside a Galena checkout (no work/BOARD.md above the cwd)');
    }
    dir = parent;
  }
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

async function runLaunch(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  if (task === undefined) {
    throw new Error('usage: lead launch <T-XXXX> [--extra-rules <file>]');
  }
  const extraRules = flagValue(args, '--extra-rules');
  const root = findRepoRoot();
  const { sessionId, worktree } = await launchTask(task, extraRules, {
    repoRoot: root,
    client: new OpencodeCliClient(),
    promptsDirPath: promptsDir(),
    statePath: stateFilePath(),
    runner: new RealGitRunner(),
  });
  console.log(`${task} ${sessionId} ${worktree}`);
}

async function runAutopilotCommand(positional: string[], args: string[]): Promise<void> {
  void positional;
  const deps: AutopilotDeps = {
    client: new OpencodeCliClient(),
    runner: new RealGitRunner(),
    statePath: stateFilePath(),
    promptsDirPath: promptsDir(),
  };
  await runAutopilot(deps, { once: flag(args, '--once'), dryRun: flag(args, '--dry-run') });
}

async function runPrereview(positional: string[]): Promise<void> {
  const task = positional[0];
  if (task === undefined) {
    throw new Error('usage: lead prereview <T-XXXX>');
  }
  const statePath = stateFilePath();
  const state = loadState(statePath);
  const record = state.tasks[task];
  if (record === undefined) {
    throw new Error(`unknown task ${task}: no session in the state file`);
  }
  const client = new OpencodeCliClient();
  const head = currentHead(new RealGitRunner(), record.worktree);
  if (head === undefined) {
    throw new Error(`cannot read HEAD of ${record.worktree}`);
  }
  const sessionId = await startPrereviewSession(
    { client, promptsDirPath: promptsDir(), worktree: record.worktree, task },
    head,
  );
  record.prereview = { sessionId, head, startedAt: new Date().toISOString() };
  saveState(statePath, state);
  console.log(`${task} pre-review ${sessionId} for ${head}`);
}

async function runReply(positional: string[]): Promise<void> {
  const task = positional[0];
  const promptFile = positional[1];
  if (task === undefined || promptFile === undefined) {
    throw new Error('usage: lead reply <T-XXXX> <prompt-file>');
  }
  await replyToWorker(task, promptFile, {
    client: new OpencodeCliClient(),
    statePath: stateFilePath(),
  });
  console.log(`${task} replied`);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runMerge(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const summary = flagValue(args, '--summary');
  if (task === undefined || summary === undefined || summary.trim().length === 0) {
    throw new Error('usage: lead merge <T-XXXX> --summary "<one line>"');
  }
  const root = findRepoRoot();
  const file = findTaskFile(root, task);
  const frontMatter = parseTaskFrontMatter(fs.readFileSync(path.join(root, 'work', file), 'utf8'));
  const worktree = path.join(path.dirname(path.resolve(root)), `galena-${task}`);
  const statePath = stateFilePath();
  mergeTask({
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
    dropFromState: (entry) => {
      const state = loadState(statePath);
      delete state.tasks[entry];
      saveState(statePath, state);
    },
  });
  console.log(`${task} merged`);
}

async function runStatus(): Promise<void> {
  const rows = await collectStatus({
    client: new OpencodeCliClient(),
    statePath: stateFilePath(),
  });
  console.log(formatStatus(rows));
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === 'launch') {
    await runLaunch(positional, rest);
  } else if (command === 'autopilot') {
    await runAutopilotCommand(positional, rest);
  } else if (command === 'prereview') {
    await runPrereview(positional);
  } else if (command === 'reply') {
    await runReply(positional);
  } else if (command === 'merge') {
    await runMerge(positional, rest);
  } else if (command === 'status') {
    await runStatus();
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
