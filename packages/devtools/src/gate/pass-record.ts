// Pass records: when the gate passes, an empty file named after the working
// tree's hash is written to `~/.zilar-lead/gate-pass/`. `lead merge` skips its
// gate re-run when the rebased tree already has a record, because the code is
// then identical to a tree that passed. `work/` is left out of the hash: the
// lead writes task files and the board there while workers run, and they are
// not code.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where every pass record lives: one empty file per passing tree. */
export const gatePassDir = path.join(os.homedir(), '.zilar-lead', 'gate-pass');

/** How many pass records are kept; the oldest are deleted first. */
export const MAX_PASS_RECORDS = 500;

function git(root: string, env: NodeJS.ProcessEnv, args: string[]): string | undefined {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

// Hashes the working tree, uncommitted changes included, with a temporary index
// so the worktree's real index is never touched. Returns undefined when git
// cannot hash the tree; the caller then just runs the gate.
export function treeKey(root: string): string | undefined {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zilar-tree-key-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
    const added = git(root, env, ['add', '-A']);
    const withoutWork = git(root, env, [
      'rm',
      '-r',
      '--cached',
      '--quiet',
      '--ignore-unmatch',
      'work',
    ]);
    if (added === undefined || withoutWork === undefined) {
      return undefined;
    }
    const hash = git(root, env, ['write-tree']);
    return hash === undefined || hash.length === 0 ? undefined : hash;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function hasPassRecord(dir: string, key: string): boolean {
  return fs.existsSync(path.join(dir, key));
}

// Deletes every record past the `keep` newest, judged by modification time.
export function pruneOldestRecords(dir: string, keep: number): void {
  const newestFirst = fs
    .readdirSync(dir)
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of newestFirst.slice(keep)) {
    fs.rmSync(path.join(dir, entry.name), { force: true });
  }
}

export function writePassRecord(dir: string, key: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, key), '');
  pruneOldestRecords(dir, MAX_PASS_RECORDS);
}

export interface PassRecordDeps {
  /** The tree key of a worktree, or undefined when it cannot be computed. */
  treeKey: (root: string) => string | undefined;
  /** Whether a pass record with this key exists. */
  hasRecord: (key: string) => boolean;
}

/** The key of the worktree's tree when that exact tree already passed the gate; undefined when the gate must run. */
export function alreadyPassedKey(root: string, deps: PassRecordDeps): string | undefined {
  const key = deps.treeKey(root);
  if (key === undefined || !deps.hasRecord(key)) {
    return undefined;
  }
  return key;
}
