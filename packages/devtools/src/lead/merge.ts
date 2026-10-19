import path from 'node:path';
import { porcelainLines, type GitRunner } from './git.js';
import {
  defaultLsof,
  defaultPs,
  findProcessesInWorktree,
  leadProcessIds,
  stopWorktreeProcesses,
  type FindProcsDeps,
  type StopProcessesDeps,
} from './processes.js';
import { parseFrontMatter } from './task-file.js';

// Pure BOARD.md edits for `lead merge`: an Active table of `| [T-XXXX](file) | Title |
// status | … |` rows and a Done table of `| [T-XXXX](file) | summary | date |` rows.

const ACTIVE_ROW = /^\|\s*\[([A-Z]+-\d+)\]\(([^)]+)\)\s*\|/;
const DONE_HEADING = /^##\s+Done\s*$/;

interface MovedBoard {
  text: string;
  removedActive: boolean;
}

// Moves the task's row out of Active and appends it to Done. A task launched from an
// uncommitted spec may have no Active row, so only a present row is removed.
function moveBoardRow(
  board: string,
  task: string,
  file: string,
  summary: string,
  today: string,
): MovedBoard {
  const lines = board.split('\n');
  let removedActive = false;
  const kept: string[] = [];
  for (const line of lines) {
    const match = ACTIVE_ROW.exec(line);
    if (match !== null && match[1] === task) {
      removedActive = true;
      continue;
    }
    kept.push(line);
  }
  const doneIndex = kept.findIndex((line) => DONE_HEADING.test(line));
  if (doneIndex === -1) {
    throw new Error('board has no Done section');
  }
  const row = `| [${task}](${file}) | ${summary} | ${today} |`;
  // Append at the end of the Done table: trailing blank lines stay last.
  let insertAt = kept.length;
  while (insertAt > doneIndex + 1 && kept[insertAt - 1]?.trim() === '') {
    insertAt -= 1;
  }
  kept.splice(insertAt, 0, row);
  return { text: kept.join('\n'), removedActive };
}

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeError';
  }
}

export interface MergeOptions {
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
  // Injectable seams so tests can stub out lsof/ps/kill/clock. All have real
  // production defaults; tests typically pass stubs that no-op everything.
  findProcs?: (worktree: string, deps: FindProcsDeps) => { pid: number; command: string }[];
  stopProcs?: (
    candidates: { pid: number; command: string }[],
    deps: StopProcessesDeps,
  ) => Promise<{ pid: number; command: string; survived: boolean }[]>;
  findProcsDeps?: FindProcsDeps;
  stopProcsDeps?: StopProcessesDeps;
  print?: (line: string) => void;
  // Runs the checks in the rebased worktree (production: `pnpm gate`). A red
  // result stops the merge before main is touched. Omitted: no gate.
  gate?: (worktree: string) => { ok: boolean; output: string };
  // Whether to push main to origin after the squash. Defaults to true; a
  // `--hold` merge sets it false.
  push?: boolean;
}

function taskStatus(options: MergeOptions): string {
  // The worker's `review`/`merged` status lives on the task branch, so read
  // the worktree's copy. Main's copy still says `todo` until the merge.
  const text = options.readText(path.join(options.worktree, 'work', options.file));
  return parseFrontMatter(text)['status'] ?? '';
}

// The path after `git status --porcelain`'s status columns. `porcelainLines` trims the
// line, so an unstaged-change line already lost a column: slicing 3 characters would
// cut into the path, so take the first space instead.
function porcelainPath(line: string): string {
  const oneColumn = line[1] === ' ' && line[2] !== ' ';
  return line.slice(oneColumn ? 2 : 3);
}

// Main's dirty check ignores the lead's bookkeeping: `work/NOW.md` and other tasks'
// untracked specs. This task's own untracked spec stays an error.
function isIgnorableMainChange(line: string, task: string): boolean {
  const path = porcelainPath(line);
  if (path === 'work/NOW.md') {
    return true;
  }
  return (
    line.startsWith('??') &&
    /^work\/T-\d+-[^/]+\.md$/.test(path) &&
    !path.startsWith(`work/${task}-`)
  );
}

// Production seams: the real lsof/ps, our own pid so the lead is never killed, and
// stdout for the invoking terminal.
function defaultFindProcsDeps(): FindProcsDeps {
  return { lsof: defaultLsof, ps: defaultPs, ...leadProcessIds() };
}

function defaultPrint(line: string): void {
  console.log(line);
}

// `stop <pid> <exe>` or `could not stop ...`; executable name only, never argv (it
// often carries a token or password), and `?` when ps truncated the name.
function printStop(
  outcome: { pid: number; command: string; survived: boolean },
  print: (line: string) => void,
): void {
  const name = outcome.command.length === 0 ? '?' : outcome.command;
  if (outcome.survived) {
    print(`could not stop ${outcome.pid} ${name}`);
  } else {
    print(`stop ${outcome.pid} ${name}`);
  }
}

// Stops processes left in the worktree, only on the success path right before the
// worktree is removed: a failed merge must not kill the worker's dev servers.
async function stopWorktreeProcessesForMerge(options: MergeOptions): Promise<void> {
  const find = options.findProcs ?? findProcessesInWorktree;
  const stop = options.stopProcs ?? stopWorktreeProcesses;
  const findDeps = options.findProcsDeps ?? defaultFindProcsDeps();
  const print = options.print ?? defaultPrint;
  let candidates;
  try {
    candidates = find(options.worktree, findDeps);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    print(
      `could not list worktree processes: ${reason}; re-run \`lead merge ${options.task}\` to finish removal`,
    );
    return;
  }
  const stopped = await stop(candidates, options.stopProcsDeps ?? {});
  for (const outcome of stopped) {
    printStop(outcome, print);
  }
}

// Everything after the lead approves, all mechanical: a rebase conflict aborts and
// reports the files, nothing is resolved automatically.
export async function mergeTask(options: MergeOptions): Promise<void> {
  const subject = `${options.task}: ${options.summary}`;
  if (subject.length > 72) {
    throw new MergeError(
      `refusing to merge: the subject is ${subject.length} characters, over the 72 limit: ${subject}`,
    );
  }
  const mainDirty = porcelainLines(options.runner, options.root);
  const nowModified = mainDirty.some((line) => porcelainPath(line) === 'work/NOW.md');
  const blocking = mainDirty.filter((line) => !isIgnorableMainChange(line, options.task));
  if (blocking.length > 0) {
    throw new MergeError(
      `refusing to merge: main checkout has uncommitted changes (${blocking.join(', ')})`,
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
  if (options.gate !== undefined) {
    const gated = options.gate(options.worktree);
    if (!gated.ok) {
      throw new MergeError(
        `refusing to merge: the gate failed after the rebase. Fix it in ${options.worktree}, commit, and run \`lead merge ${options.task}\` again.\n${gated.output}`,
      );
    }
  }
  const subjectsResult = options.runner.run(options.root, [
    'log',
    '--reverse',
    '--format=%s',
    `main..${options.branch}`,
  ]);
  if (!subjectsResult.ok) {
    throw new MergeError(`could not read commits of ${options.branch}`);
  }
  const subjects = subjectsResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Compute the board text before the squash stages anything, so a board throw leaves
  // main untouched and the merge re-runnable.
  const boardFile = path.join(options.root, 'work', 'BOARD.md');
  const boardText = moveBoardRow(
    options.readText(boardFile),
    options.task,
    options.file,
    options.summary,
    options.today,
  ).text;
  const squashed = options.runner.run(options.root, ['merge', '--squash', options.branch]);
  if (!squashed.ok) {
    throw new MergeError(`squash of ${options.branch} failed`);
  }
  options.writeText(boardFile, boardText);
  const staged = options.runner.run(options.root, ['add', 'work/BOARD.md']);
  if (!staged.ok) {
    throw new MergeError('board stage failed');
  }
  if (nowModified) {
    const stagedNow = options.runner.run(options.root, ['add', 'work/NOW.md']);
    if (!stagedNow.ok) {
      throw new MergeError('NOW.md stage failed');
    }
  }
  const body = [`Squashed from ${options.branch}:`, ...subjects.map((s) => `- ${s}`)].join('\n');
  const committed = options.runner.run(options.root, [
    'commit',
    '-q',
    '-m',
    `${options.task}: ${options.summary}`,
    '-m',
    body,
  ]);
  if (!committed.ok) {
    throw new MergeError('squash commit failed');
  }
  const same = options.runner.run(options.root, [
    'diff',
    '--quiet',
    'HEAD',
    options.branch,
    '--',
    '.',
    ':(exclude)work/BOARD.md',
    ':(exclude)work/NOW.md',
  ]);
  if (!same.ok) {
    throw new MergeError(`squash result differs from ${options.branch}; nothing pushed`);
  }
  if (options.push !== false) {
    const pushed = options.runner.run(options.root, ['push', '-q', 'origin', 'main']);
    if (!pushed.ok) {
      throw new MergeError('push of main failed; the merge is local only');
    }
  }
  // Stop worktree processes right before the worktree is removed; anything earlier
  // risks killing dev servers on a failed merge.
  await stopWorktreeProcessesForMerge(options);
  const removed = options.runner.run(options.root, ['worktree', 'remove', options.worktree]);
  if (!removed.ok) {
    throw new MergeError(`could not remove worktree ${options.worktree}; branch kept`);
  }
  const deleted = options.runner.run(options.root, ['branch', '-D', options.branch]);
  if (!deleted.ok) {
    throw new MergeError(`could not delete branch ${options.branch}`);
  }
  options.dropFromState(options.task);
}
