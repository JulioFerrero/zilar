import path from 'node:path';

import { BatchError } from './types.js';

export function waveWorktree(root: string): string {
  return path.join(path.dirname(path.resolve(root)), 'zilar-wave');
}

export function taskWorktree(root: string, task: string): string {
  return path.join(path.dirname(path.resolve(root)), `zilar-${task}`);
}

export function findTaskFileIn(
  listDir: (dir: string) => string[],
  checkout: string,
  task: string,
): string {
  const work = path.join(checkout, 'work');
  const matches = listDir(work).filter(
    (entry) => entry.startsWith(`${task}-`) && entry.endsWith('.md'),
  );
  if (matches.length !== 1) {
    throw new BatchError(`expected one task file for ${task} in ${work}, found ${matches.length}`);
  }
  return matches[0] as string;
}

export function validateTasks(tasks: string[]): void {
  if (tasks.length === 0) {
    throw new BatchError('give at least one task: lead batch <check|merge> <T-XXXX> ...');
  }
  for (const task of tasks) {
    if (!/^T-\d+$/.test(task)) {
      throw new BatchError(`not a task id: ${JSON.stringify(task)}`);
    }
  }
  if (new Set(tasks).size !== tasks.length) {
    throw new BatchError('a task is listed twice');
  }
}

export function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

function fileStem(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.indexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

function dirOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash);
}

/**
 * The task that owns a failing file: the first task whose diff holds it. A test
 * file also belongs to the task whose diff holds a file with the same base name
 * in the same folder (`foo.test.tsx` and `foo.tsx`).
 */
export function ownerOf(
  file: string,
  owned: { task: string; files: string[] }[],
): string | undefined {
  const direct = owned.find((entry) => entry.files.includes(file));
  if (direct !== undefined) {
    return direct.task;
  }
  if (!/\.test\.tsx?$/.test(file)) {
    return undefined;
  }
  const stem = fileStem(file);
  const dir = dirOf(file);
  return owned.find((entry) =>
    entry.files.some((other) => dirOf(other) === dir && fileStem(other) === stem),
  )?.task;
}
