import path from 'node:path';
import { moveBoardRow } from './board.js';
import { porcelainLines, type GitRunner } from './git.js';
import {
  findProcessesInWorktree,
  stopWorktreeProcesses,
  type FindProcsDeps,
  type StopProcessesDeps,
} from './processes.js';
import { parseFrontMatter } from './task-file.js';

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeError';
  }
}

export interface MergeOptions {
  // The main checkout (BOARD.md and the task file live here).
  root: string;
  task: string;
  file: string;
  worktree: string;
  branch: string;
  summary: string;
  today: string;
  runner: GitRunner;
  readText: (file: string) => string;
  writeText: (file: string, text: string) => void;
  dropFromState: (task: string) => void;
  // Injectable seams so tests can stub out lsof/ps/kill/clock. Production
  // callers pass the real implementations; tests pass stubs that return no
  // candidates and never kill anything. `findProcsDeps` is required in
  // production because the lead must always identify its own pid/parent.
  findProcs: (worktree: string, deps: FindProcsDeps) => { pid: number; command: string }[];
  stopProcs: (
    candidates: { pid: number; command: string }[],
    deps: StopProcessesDeps,
  ) => Promise<{ pid: number; command: string }[]>;
  findProcsDeps: FindProcsDeps;
  stopProcsDeps: StopProcessesDeps;
  print: (line: string) => void;
}

function taskStatus(options: MergeOptions): string {
  // The worker's `review`/`merged` status lives on the task branch, so read
  // the worktree's copy. Main's copy still says `todo` until the merge.
  const text = options.readText(path.join(options.worktree, 'work', options.file));
  return parseFrontMatter(text)['status'] ?? '';
}

// Stops processes left in the worktree before the worktree is removed.
// Dev servers, Metro, etc. survive `git worktree remove` and keep holding the
// ports; printing every AI answer twice was the symptom. The default seams
// reach for `lsof` and `ps`, but tests inject their own.
async function stopWorktreeProcessesForMerge(options: MergeOptions): Promise<void> {
  const find = options.findProcs ?? findProcessesInWorktree;
  const stop = options.stopProcs ?? stopWorktreeProcesses;
  const findDeps = options.findProcsDeps;
  if (findDeps === undefined) {
    throw new MergeError(
      'merge needs findProcsDeps (currentPid/parentPid); production callers must provide it',
    );
  }
  const candidates = find(options.worktree, findDeps);
  const stopped = await stop(candidates, options.stopProcsDeps ?? {});
  const print = options.print ?? ((line: string): void => console.log(line));
  for (const entry of stopped) {
    print(`stop ${entry.pid} ${entry.command}`);
  }
}

// Everything `lead merge` does after the lead approves. All mechanical, no
// judgment: on a rebase conflict it aborts and reports the conflicted files,
// and it never resolves anything automatically.
export async function mergeTask(options: MergeOptions): Promise<void> {
  const mainDirty = porcelainLines(options.runner, options.root);
  if (mainDirty.length > 0) {
    throw new MergeError(
      `refusing to merge: main checkout has uncommitted changes (${mainDirty.join(', ')})`,
    );
  }
  const status = taskStatus(options);
  if (status !== 'merged') {
    throw new MergeError(
      `refusing to merge: task status is ${JSON.stringify(status)}, expected "merged" (the lead sets it when approving)`,
    );
  }
  const worktreeDirty = porcelainLines(options.runner, options.worktree);
  if (worktreeDirty.length > 0) {
    throw new MergeError(
      `refusing to merge: worktree has uncommitted changes (${worktreeDirty.join(', ')})`,
    );
  }
  await stopWorktreeProcessesForMerge(options);
  const rebased = options.runner.run(options.worktree, ['rebase', 'main']);
  if (!rebased.ok) {
    const conflicted = options.runner
      .run(options.worktree, ['diff', '--name-only', '--diff-filter=U'])
      .stdout.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    options.runner.run(options.worktree, ['rebase', '--abort']);
    throw new MergeError(
      `rebase conflicted on: ${conflicted.join(', ') || '(unknown files)'}. Aborted; resolve by hand.`,
    );
  }
  const fastForward = options.runner.run(options.root, ['merge', '--ff-only', options.branch]);
  if (!fastForward.ok) {
    throw new MergeError(`fast-forward merge of ${options.branch} failed`);
  }
  const boardFile = path.join(options.root, 'work', 'BOARD.md');
  options.writeText(
    boardFile,
    moveBoardRow(
      options.readText(boardFile),
      options.task,
      options.file,
      options.summary,
      options.today,
    ).text,
  );
  const committed = options.runner.run(options.root, [
    'commit',
    '-qam',
    `board: ${options.task} merged`,
  ]);
  if (!committed.ok) {
    throw new MergeError('board commit failed');
  }
  const pushed = options.runner.run(options.root, ['push', '-q', 'origin', 'main']);
  if (!pushed.ok) {
    throw new MergeError('push of main failed; the merge is local only');
  }
  const removed = options.runner.run(options.root, ['worktree', 'remove', options.worktree]);
  if (!removed.ok) {
    throw new MergeError(`could not remove worktree ${options.worktree}; branch kept`);
  }
  const deleted = options.runner.run(options.root, ['branch', '-d', options.branch]);
  if (!deleted.ok) {
    throw new MergeError(`could not delete branch ${options.branch}`);
  }
  options.dropFromState(options.task);
}
