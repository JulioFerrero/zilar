import fs from 'node:fs';
import path from 'node:path';
import { runAutopilot, type AutopilotDeps } from '../autopilot.js';
import { OpencodeCliClient } from '../client.js';
import { doctorWorktreeFor, startDoctorSession } from '../doctor.js';
import { currentHead, RealGitRunner } from '../git.js';
import { findTaskFile, launchTask, parseLaunchArgs } from '../launch.js';
import { promptsDir } from '../prompts.js';
import { replyToWorker } from '../reply.js';
import { collectSnapshot } from '../collect-snapshot.js';
import { checkSpec, formatProblems } from '../spec-check.js';
import { startPrereviewSession } from '../start-prereview.js';
import { switchModel, switchModelInPlace } from '../switch-model.js';
import { loadState, stateFilePath, updateState } from '../state.js';
import { taskFileDir } from '../task-file.js';
import { findRepoRoot } from '../repo-root.js';
import { flag, flagValue } from './args.js';

export async function runLaunch(args: string[]): Promise<void> {
  const options = parseLaunchArgs(args);
  const root = findRepoRoot();
  const { sessionId, worktree } = await launchTask(options, {
    repoRoot: root,
    client: new OpencodeCliClient(),
    promptsDirPath: promptsDir(),
    statePath: stateFilePath(),
    runner: new RealGitRunner(),
  });
  console.log(`${options.task} ${sessionId} ${worktree}`);
}

export async function runAutopilotCommand(positional: string[], args: string[]): Promise<void> {
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

export async function runDoctor(positional: string[], args: string[]): Promise<void> {
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
  const { sessionId, model } = await startDoctorSession(
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
      model,
    };
  });
  console.log(`doctor ${sessionId} ${doctorWorktreeFor(root)}`);
}

export async function runPrereview(positional: string[]): Promise<void> {
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
  const { sessionId, model } = await startPrereviewSession(
    { client, promptsDirPath: promptsDir(), worktree: record.worktree, task },
    head,
  );
  const startedAt = new Date().toISOString();
  updateState(statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined) {
      current.prereview = { sessionId, head, startedAt, model };
    }
  });
  console.log(`${task} pre-review ${sessionId} for ${head}`);
}

export async function runReply(positional: string[], args: string[]): Promise<void> {
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

export async function runSwitchModel(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const model = positional[1];
  if (task === undefined || model === undefined) {
    throw new Error(
      'usage: lead switch-model <T-XXXX> <provider/model> [--extra-rules <file>] [--in-place] (--in-place keeps the same session and its context; send lead reply after it if the worker is idle)',
    );
  }
  const extraRules = flagValue(args, '--extra-rules');
  const inPlace = flag(args, '--in-place');
  if (inPlace && extraRules !== undefined) {
    throw new Error('--extra-rules needs a new session; drop --in-place');
  }
  const root = findRepoRoot();
  if (inPlace) {
    const { sessionId, model: chosen } = await switchModelInPlace(task, model, {
      repoRoot: root,
      client: new OpencodeCliClient(),
      promptsDirPath: promptsDir(),
      statePath: stateFilePath(),
    });
    console.log(`${task} ${sessionId} ${chosen}`);
    return;
  }
  const { sessionId, model: chosen } = await switchModel(task, model, extraRules, {
    repoRoot: root,
    client: new OpencodeCliClient(),
    promptsDirPath: promptsDir(),
    statePath: stateFilePath(),
  });
  console.log(`${task} ${sessionId} ${chosen}`);
}

export function runSpecCheck(positional: string[]): void {
  const task = positional[0];
  if (task === undefined) {
    throw new Error('usage: lead spec-check <T-XXXX>');
  }
  const root = findRepoRoot();
  const dir = taskFileDir(root, task, stateFilePath());
  const file = findTaskFile(dir, task);
  const text = fs.readFileSync(path.join(dir, 'work', file), 'utf8');
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
export async function runSnapshot(positional: string[], page: boolean): Promise<void> {
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
