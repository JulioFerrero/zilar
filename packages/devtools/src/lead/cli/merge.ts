import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { alreadyPassedKey, gatePassDir, hasPassRecord, treeKey } from '../../gate/pass-record.js';
import { realBatchDeps, realBatchMergeDeps, runBatchCheck, runBatchMerge } from '../batch.js';
import { RealGitRunner } from '../git.js';
import { findTaskFile } from '../launch.js';
import { mergeTask } from '../merge.js';
import { stateFilePath, updateState } from '../state.js';
import { parseTaskFrontMatter, taskFileDir } from '../task-file.js';
import { findRepoRoot } from '../repo-root.js';
import { flagValue } from './args.js';

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// The checks every merge must pass, run in the rebased worktree. The output
// tail is kept so the lead sees the failing step without rerunning it. A tree
// that already passed the gate (a pass record exists for its hash) is not run
// again: the code is identical to what passed.
export function runGate(worktree: string): { ok: boolean; output: string } {
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

export async function runMerge(positional: string[], args: string[]): Promise<void> {
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

export async function runPush(): Promise<void> {
  const root = findRepoRoot();
  const pushed = new RealGitRunner().run(root, ['push', '-q', 'origin', 'main']);
  if (!pushed.ok) {
    throw new Error('push of main failed');
  }
  console.log('main pushed');
}

export async function runBatch(positional: string[]): Promise<void> {
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
