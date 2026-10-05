import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runAutopilot, type AutopilotDeps } from './autopilot.js';
import { OpencodeCliClient } from './client.js';
import { doctorWorktreeFor, startDoctorSession } from './doctor.js';
import { RealGitRunner } from './git.js';
import { findTaskFile, launchTask } from './launch.js';
import { mergeTask } from './merge.js';
import { promptsDir } from './prompts.js';
import { replyToWorker } from './reply.js';
import { collectSnapshot } from './collect-snapshot.js';
import { checkSpec, formatProblems } from './spec-check.js';
import { startPrereviewSession } from './start-prereview.js';
import { switchModel } from './switch-model.js';
import { collectStatus, formatStatus } from './status.js';
import { currentHead } from './git.js';
import { loadState, stateFilePath, updateState } from './state.js';
import { parseTaskFrontMatter } from './task-file.js';

const HELP = `lead — zero-token supervision of OpenCode workers

Usage: lead <command> [options]

  launch <T-XXXX> [--extra-rules <file>]                    create the worktree and worker session
  switch-model <T-XXXX> <provider/model> [--extra-rules <file>]
                                                            move a tracked worker onto a new model (quota fallback)
  autopilot [--once] [--dry-run]                            watch sessions, answer permissions, nudge, pre-review
  doctor [--since <sha>]                                    audit main now with a Muse doctor session
  prereview <T-XXXX>                                        start a Muse pre-review manually
  reply <T-XXXX> <prompt-file> [--fresh]                   interrupt the worker and re-prompt it
  merge <T-XXXX> --summary "<one line>" [--skip-gate]       rebase, run the gate, squash onto main, board, push, clean up
  spec-check <T-XXXX>                                       check a spec's paths, routes and web claims against the code
  snapshot                                                  JSON of every task in flight, its step and timings
  dashboard <out.html>                                      the snapshot rendered as the dashboard page
  status                                                    compact table of every tracked task

State lives outside the repo at ~/.zilar-lead/state.json (or ZILAR_LEAD_STATE).
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
      throw new Error('not inside a Zilar checkout (no work/BOARD.md above the cwd)');
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
    repoRoot: findRepoRoot(),
  };
  await runAutopilot(deps, { once: flag(args, '--once'), dryRun: flag(args, '--dry-run') });
}

async function runDoctor(positional: string[], args: string[]): Promise<void> {
  void positional;
  const root = findRepoRoot();
  const statePath = stateFilePath();
  const runner = new RealGitRunner();
  const head = currentHead(runner, root);
  if (head === undefined) {
    throw new Error(`cannot read HEAD of ${root}`);
  }
  const state = loadState(statePath);
  const since = flagValue(args, '--since') ?? state.doctor?.head;
  if (since === undefined) {
    throw new Error('no previous audit: pass --since <sha>');
  }
  const client = new OpencodeCliClient();
  const sessionId = await startDoctorSession(
    { client, runner, promptsDirPath: promptsDir(), repoRoot: root },
    { head, since },
  );
  const startedAt = new Date().toISOString();
  updateState(statePath, (fresh) => {
    fresh.doctor = {
      sessionId,
      head,
      since,
      startedAt,
      reportedForHead: undefined,
      stalledReportedForHead: undefined,
    };
  });
  console.log(`doctor ${sessionId} ${doctorWorktreeFor(root)}`);
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
  const startedAt = new Date().toISOString();
  updateState(statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined) {
      current.prereview = { sessionId, head, startedAt };
    }
  });
  console.log(`${task} pre-review ${sessionId} for ${head}`);
}

async function runReply(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const promptFile = positional[1];
  if (task === undefined || promptFile === undefined) {
    throw new Error('usage: lead reply <T-XXXX> <prompt-file> [--fresh]');
  }
  const fresh = flag(args, '--fresh');
  await replyToWorker(
    task,
    promptFile,
    {
      client: new OpencodeCliClient(),
      statePath: stateFilePath(),
      promptsDirPath: promptsDir(),
      // The non-fresh path never uses the repo root, and finding it throws
      // outside a checkout — so only look it up when --fresh needs it.
      repoRoot: fresh ? findRepoRoot() : '',
    },
    { fresh },
  );
  console.log(`${task} replied`);
}

async function runSwitchModel(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const model = positional[1];
  if (task === undefined || model === undefined) {
    throw new Error('usage: lead switch-model <T-XXXX> <provider/model> [--extra-rules <file>]');
  }
  const extraRules = flagValue(args, '--extra-rules');
  const root = findRepoRoot();
  const { sessionId, model: chosen } = await switchModel(task, model, extraRules, {
    repoRoot: root,
    client: new OpencodeCliClient(),
    promptsDirPath: promptsDir(),
    statePath: stateFilePath(),
  });
  console.log(`${task} ${sessionId} ${chosen}`);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// The checks every merge must pass, run in the rebased worktree. The output
// tail is kept so the lead sees the failing step without rerunning it.
function runGate(worktree: string): { ok: boolean; output: string } {
  const result = spawnSync('pnpm', ['gate'], {
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
    throw new Error('usage: lead merge <T-XXXX> --summary "<one line>"');
  }
  const root = findRepoRoot();
  const file = findTaskFile(root, task);
  const frontMatter = parseTaskFrontMatter(fs.readFileSync(path.join(root, 'work', file), 'utf8'));
  const worktree = path.join(path.dirname(path.resolve(root)), `zilar-${task}`);
  const statePath = stateFilePath();
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
    ...(args.includes('--skip-gate') ? {} : { gate: runGate }),
    dropFromState: (entry) => {
      updateState(statePath, (state) => {
        delete state.tasks[entry];
      });
    },
  });
  console.log(`${task} merged`);
}

function runSpecCheck(positional: string[]): void {
  const task = positional[0];
  if (task === undefined) {
    throw new Error('usage: lead spec-check <T-XXXX>');
  }
  const root = findRepoRoot();
  const file = findTaskFile(root, task);
  const text = fs.readFileSync(path.join(root, 'work', file), 'utf8');
  const serverRoot = path.join(root, 'apps', 'server', 'src');
  const problems = checkSpec(text, {
    exists: (relative) => fs.existsSync(path.join(root, relative)),
    serverText: () => {
      const chunks: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.endsWith('.ts')) {
            chunks.push(fs.readFileSync(full, 'utf8'));
          }
        }
      };
      walk(serverRoot);
      return chunks.join('\n');
    },
  });
  console.log(formatProblems(task, problems));
  if (problems.length > 0) {
    process.exitCode = 1;
  }
}

// `lead snapshot` prints the JSON the dashboard shows; `lead dashboard <out>`
// writes it into the page template. Claude publishes that page as an Artifact.
async function runSnapshot(positional: string[], page: boolean): Promise<void> {
  const root = findRepoRoot();
  const snapshot = await collectSnapshot({
    client: new OpencodeCliClient(),
    runner: new RealGitRunner(),
    statePath: stateFilePath(),
    root,
    now: Date.now(),
  });
  const json = JSON.stringify(snapshot);
  if (!page) {
    console.log(json);
    return;
  }
  const out = positional[0];
  if (out === undefined) {
    throw new Error('usage: lead dashboard <out.html>');
  }
  const template = fs.readFileSync(
    path.join(root, 'packages', 'devtools', 'dashboard', 'template.html'),
    'utf8',
  );
  // `<` is escaped so task text can never close the script tag.
  fs.writeFileSync(out, template.replace('__SNAPSHOT__', json.replace(/</g, '\\u003c')));
  console.log(`dashboard written to ${out} (${snapshot.active.length} active)`);
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
