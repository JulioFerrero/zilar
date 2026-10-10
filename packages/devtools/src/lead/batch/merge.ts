import path from 'node:path';

import type { GitRunner } from '../git.js';
import type { MergeOptions } from '../merge.js';
import { parseFrontMatter } from '../task-file.js';
import { isRecord } from './parsers.js';
import { lines } from './text.js';
import { BatchError, type LastWave } from './types.js';
import { findTaskFileIn, taskWorktree, validateTasks } from './wave.js';

export interface BatchMergeDeps {
  root: string;
  git: GitRunner;
  readText: (file: string) => string;
  exists: (file: string) => boolean;
  waveRoot: string;
  print: (line: string) => void;
  listDir: (dir: string) => string[];
  /** Everything `mergeTask` needs except the per-task fields and the gate. */
  mergeBase: Omit<MergeOptions, 'task' | 'file' | 'worktree' | 'branch' | 'summary' | 'gate'>;
  merge: (options: MergeOptions) => Promise<void>;
}

export interface BatchMergeResult {
  merged: string[];
  matches: boolean;
  differing: string[];
}

function readLastWave(deps: BatchMergeDeps): LastWave {
  const file = path.join(deps.waveRoot, 'last.json');
  if (!deps.exists(file)) {
    throw new BatchError('no checked wave: run `lead batch check` first');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readText(file));
  } catch {
    throw new BatchError(`${file} is not valid JSON; run \`lead batch check\` again`);
  }
  if (
    !isRecord(parsed) ||
    typeof parsed['ok'] !== 'boolean' ||
    typeof parsed['wave'] !== 'string' ||
    !Array.isArray(parsed['tasks']) ||
    !isRecord(parsed['heads'])
  ) {
    throw new BatchError(`${file} has an unexpected shape; run \`lead batch check\` again`);
  }
  return parsed as unknown as LastWave;
}

function boardTitle(boardText: string, task: string): string {
  for (const line of boardText.split('\n')) {
    const match = /^\|\s*\[([A-Z]+-\d+)\]\([^)]+\)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (match !== null && match[1] === task && (match[2] as string).length > 0) {
      return match[2] as string;
    }
  }
  throw new BatchError(`work/BOARD.md has no row with a title for ${task}`);
}

export async function runBatchMerge(
  deps: BatchMergeDeps,
  tasks: string[],
): Promise<BatchMergeResult> {
  validateTasks(tasks);
  const last = readLastWave(deps);
  if (!last.ok) {
    throw new BatchError('the last checked wave was not OK; fix it and run `lead batch check`');
  }
  const checked = new Set(last.tasks);
  if (checked.size !== tasks.length || tasks.some((task) => !checked.has(task))) {
    throw new BatchError(
      `the checked wave was ${last.tasks.join(' ')}; this list differs. Run \`lead batch check\` for it`,
    );
  }
  for (const task of tasks) {
    const entry = last.heads[task];
    if (entry === undefined) {
      throw new BatchError(`${task} has no recorded head in the checked wave`);
    }
    const head = deps.git.run(deps.root, ['rev-parse', entry.branch]).stdout.trim();
    if (head !== entry.head) {
      throw new BatchError(
        `${task}: branch ${entry.branch} moved since the check (${entry.head.slice(0, 8)} to ${head.slice(0, 8) || 'missing'}). Run \`lead batch check\` again`,
      );
    }
  }
  const boardText = deps.readText(path.join(deps.root, 'work', 'BOARD.md'));
  const titles = new Map(tasks.map((task) => [task, boardTitle(boardText, task)]));

  const merged: string[] = [];
  for (const task of tasks) {
    const file = findTaskFileIn(deps.listDir, deps.root, task);
    const frontMatter = parseFrontMatter(deps.readText(path.join(deps.root, 'work', file)));
    const entry = last.heads[task] as { branch: string; head: string };
    await deps.merge({
      ...deps.mergeBase,
      task,
      file,
      worktree: taskWorktree(deps.root, task),
      branch: frontMatter['branch'] ?? entry.branch,
      summary: titles.get(task) as string,
    });
    merged.push(task);
    deps.print(`${task} merged`);
  }

  const same = deps.git.run(deps.root, [
    'diff',
    '--quiet',
    last.wave,
    'HEAD',
    '--',
    '.',
    ':(exclude)work',
  ]);
  if (same.ok) {
    deps.print('wave merged: main matches the checked tree');
    return { merged, matches: true, differing: [] };
  }
  const differing = lines(
    deps.git.run(deps.root, ['diff', '--name-only', last.wave, 'HEAD', '--', '.', ':(exclude)work'])
      .stdout,
  );
  deps.print(`WARNING: main differs from the checked tree in ${differing.length} path(s):`);
  for (const file of differing) {
    deps.print(`  ${file}`);
  }
  return { merged, matches: false, differing };
}
