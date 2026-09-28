import path from 'node:path';
import { moveBoardRow } from './board.js';
import { porcelainLines, type GitRunner } from './git.js';
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
}

function taskStatus(options: MergeOptions): string {
  const text = options.readText(path.join(options.root, 'work', options.file));
  return parseFrontMatter(text)['status'] ?? '';
}

// Everything `lead merge` does after the lead approves. All mechanical, no
// judgment: on a rebase conflict it aborts and reports the conflicted files,
// and it never resolves anything automatically.
export function mergeTask(options: MergeOptions): void {
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
  const moved = moveBoardRow(
    options.readText(boardFile),
    options.task,
    options.file,
    options.summary,
    options.today,
  );
  void moved;
  options.writeText(boardFile, moved.text);
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
