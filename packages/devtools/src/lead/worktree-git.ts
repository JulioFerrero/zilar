import fs from 'node:fs';
import { Result, Schema } from 'effect';
import { currentHead, type GitRunner } from './git.js';

// One worktree's git facts at one point in time. `key` is HEAD plus the porcelain
// status: when it repeats, the cached facts are reused and no git command runs.
export interface WorktreeGit {
  key: string;
  head: string | undefined;
  nameStatus: string;
  porcelain: string;
  commitMs: number;
  commits: number;
  ok: boolean;
}

export type GitCache = Map<string, WorktreeGit>;

const worktreeGitSchema = Schema.Struct({
  key: Schema.String,
  head: Schema.optional(Schema.String),
  nameStatus: Schema.String,
  porcelain: Schema.String,
  commitMs: Schema.Number,
  commits: Schema.Number,
  ok: Schema.Boolean,
});

const gitCacheFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  worktrees: Schema.Record(Schema.String, worktreeGitSchema),
});

// The git cache lives next to the state file so it survives the fresh `--data` process;
// a missing or malformed file just means the next refresh runs git again.
export function loadGitCache(file: string): GitCache {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  const validated = Schema.decodeUnknownResult(gitCacheFileSchema)(parsed);
  if (Result.isFailure(validated)) {
    return new Map();
  }
  const cache: GitCache = new Map();
  for (const [worktree, entry] of Object.entries(validated.success.worktrees)) {
    cache.set(worktree, {
      key: entry.key,
      head: entry.head,
      nameStatus: entry.nameStatus,
      porcelain: entry.porcelain,
      commitMs: entry.commitMs,
      commits: entry.commits,
      ok: entry.ok,
    });
  }
  return cache;
}

export function saveGitCache(file: string, cache: GitCache): void {
  const worktrees: Record<string, WorktreeGit> = {};
  for (const [worktree, entry] of cache) {
    worktrees[worktree] = entry;
  }
  try {
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, worktrees })}\n`);
  } catch {
    // Best effort: a failed write only costs the next refresh its cache hit.
  }
}

function lastCommitMs(runner: GitRunner, cwd: string): number {
  const result = runner.run(cwd, ['log', '-1', '--format=%ct']);
  const seconds = Number(result.stdout.trim());
  return result.ok && Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function commitsAhead(runner: GitRunner, cwd: string): number {
  const result = runner.run(cwd, ['rev-list', '--count', 'main..HEAD']);
  return result.ok ? Number(result.stdout.trim()) || 0 : 0;
}

export function readWorktreeGit(
  runner: GitRunner,
  worktree: string,
  cache?: GitCache,
): WorktreeGit {
  const head = currentHead(runner, worktree);
  if (cache === undefined) {
    return {
      key: head ?? '',
      head,
      nameStatus: '',
      porcelain: '',
      commitMs: lastCommitMs(runner, worktree),
      commits: commitsAhead(runner, worktree),
      ok: false,
    };
  }
  const status = runner.run(worktree, ['status', '--porcelain']);
  const porcelain = status.ok ? status.stdout : '';
  const key = `${head ?? ''}\u0000${porcelain}`;
  const cached = cache.get(worktree);
  if (cached !== undefined && cached.key === key) {
    return cached;
  }
  const base = runner.run(worktree, ['merge-base', 'main', 'HEAD']);
  let nameStatus = '';
  let ok = false;
  if (base.ok) {
    const diff = runner.run(worktree, ['diff', '--name-status', base.stdout.trim()]);
    if (diff.ok) {
      nameStatus = diff.stdout;
      ok = true;
    }
  }
  const entry: WorktreeGit = {
    key,
    head,
    nameStatus,
    porcelain,
    commitMs: lastCommitMs(runner, worktree),
    commits: commitsAhead(runner, worktree),
    ok,
  };
  cache.set(worktree, entry);
  return entry;
}
