import fs from 'node:fs';
import path from 'node:path';
import { Result, Schema } from 'effect';
import { type OpenCodeClient } from './client.js';
import { currentHead, type GitRunner } from './git.js';
import { findTaskFile } from './launch.js';
import { newestMessageMs, summarizeSession } from './session.js';
import {
  derivePhase,
  formatAge,
  sortActive,
  type MergedToday,
  type QueuedTask,
  type Snapshot,
  type SnapshotTask,
} from './snapshot.js';
import { loadState } from './state.js';
import { parseFrontMatter } from './task-file.js';

export interface SnapshotDeps {
  client: OpenCodeClient;
  runner: GitRunner;
  statePath: string;
  /** The main checkout (work/ and the board live here). */
  root: string;
  now: number;
  /** Per-refresh `session.message.list` results, shared with `buildView`. */
  messages?: MessageCache | undefined;
  /** Cross-refresh git results, keyed by worktree. */
  gitCache?: GitCache | undefined;
}

// A per-refresh cache of `session.message.list` results, keyed by session id.
// `buildView` reuses what `collectSnapshot` already fetched instead of
// spawning `opencode2` a second time for the same session. The stored limit
// lets a later, larger request grow the entry.
export interface MessageCacheEntry {
  messages: unknown[];
  limit: number;
}

export type MessageCache = Map<string, MessageCacheEntry>;

export async function listSessionMessages(
  client: OpenCodeClient,
  cache: MessageCache | undefined,
  sessionId: string,
  limit: number,
): Promise<unknown[]> {
  const cached = cache?.get(sessionId);
  if (cached !== undefined && cached.limit >= limit) {
    return cached.messages;
  }
  const fetchLimit = cached === undefined ? limit : Math.max(limit, cached.limit);
  const messages = await client.listMessages(sessionId, fetchLimit);
  cache?.set(sessionId, { messages, limit: fetchLimit });
  return messages;
}

// Everything `buildView` and `collectSnapshot` need from one worktree at one
// point in time. `key` is HEAD plus the porcelain status: when it repeats, the
// cached `commitMs`, `commits` and diff are reused and no `git log`,
// `git rev-list`, `git merge-base` or `git diff` runs.
export interface WorktreeGit {
  key: string;
  head: string | undefined;
  nameStatus: string;
  porcelain: string;
  commitMs: number;
  commits: number;
  /** False when the diff could not be read; the caller keeps the old files. */
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

// The git cache lives in a file next to the state file so it survives the
// fresh `--data` process the watcher spawns on every refresh. Reads are
// best-effort: a missing or malformed file just means the next refresh runs
// the git commands again.
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

function iso(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : '';
}

function ageSince(now: number, ms: number): string {
  return ms > 0 ? formatAge(now - ms) : '';
}

function readFields(dir: string, task: string): Record<string, string> | null {
  try {
    const file = findTaskFile(dir, task);
    return parseFrontMatter(fs.readFileSync(path.join(dir, 'work', file), 'utf8'));
  } catch {
    return null;
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

// Reads one worktree's git facts, reusing the cache when HEAD and the
// porcelain status are unchanged. Without a cache (e.g. `lead snapshot`) it
// only reads what the snapshot needs, exactly like before.
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

function fileMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

async function activeTasks(deps: SnapshotDeps): Promise<SnapshotTask[]> {
  const state = loadState(deps.statePath);
  const tasks: SnapshotTask[] = [];
  for (const id of Object.keys(state.tasks).sort()) {
    const record = state.tasks[id];
    if (record === undefined || record.role !== 'worker' || !fs.existsSync(record.worktree)) {
      continue;
    }
    const fields = readFields(record.worktree, id);
    if (fields === null || fields['status'] === 'merged') {
      continue;
    }
    let sessionState = 'unknown';
    let quotaError = false;
    let lastActivityMs = 0;
    try {
      const messages = await listSessionMessages(deps.client, deps.messages, record.sessionId, 30);
      const summary = summarizeSession(messages);
      sessionState = summary.state;
      quotaError = summary.quotaError;
      lastActivityMs = newestMessageMs(messages);
    } catch {
      sessionState = 'unknown';
    }
    let prereviewState = 'none';
    if (record.prereview !== undefined) {
      try {
        // 20, not 5: the same list later serves `buildView`'s live step and
        // speed line, so one fetch covers both call sites.
        prereviewState = summarizeSession(
          await listSessionMessages(deps.client, deps.messages, record.prereview.sessionId, 20),
        ).state;
      } catch {
        prereviewState = 'unknown';
      }
    }
    const head = readWorktreeGit(deps.runner, record.worktree, deps.gitCache);
    const reviewFile = path.join(record.worktree, 'PREREVIEW.md');
    const phase = derivePhase({
      taskStatus: fields['status'] ?? '',
      sessionState,
      quotaError,
      autoFixRounds: record.autoFixRounds,
      prereviewForHead: head.head !== undefined && record.prereview?.head === head.head,
      prereviewSessionState: prereviewState,
      prereviewFilePresent: fs.existsSync(reviewFile),
      packetReady: head.head !== undefined && record.packetReadyForHead === head.head,
    });
    const startedMs = Date.parse(record.startedAt) || 0;
    const commitMs = head.commitMs;
    const prereviewMs = Date.parse(record.prereview?.startedAt ?? '') || 0;
    const sinceMs =
      phase.id === 'prereview'
        ? prereviewMs
        : phase.id === 'waiting-lead'
          ? fileMtimeMs(reviewFile)
          : phase.id === 'coding'
            ? startedMs
            : Math.max(commitMs, lastActivityMs);
    tasks.push({
      id,
      title: (fields['title'] ?? '').replace(/^Mobile:\s*/, 'Mobile: '),
      model: record.model.replace(/^meta\//, ''),
      phase,
      phaseSince: iso(sinceMs),
      phaseAge: ageSince(deps.now, sinceMs),
      startedAt: iso(startedMs),
      totalAge: ageSince(deps.now, startedMs),
      lastActivity: iso(lastActivityMs),
      lastActivityAge: ageSince(deps.now, lastActivityMs),
      commits: head.commits,
      autoFixRounds: record.autoFixRounds,
      lastEscalation: record.lastEscalation ?? '',
    });
  }
  return sortActive(tasks);
}

function queuedTasks(deps: SnapshotDeps, activeIds: Set<string>): QueuedTask[] {
  const workDir = path.join(deps.root, 'work');
  const queued: QueuedTask[] = [];
  for (const name of fs.readdirSync(workDir).sort()) {
    const id = /^(T-\d+)-/.exec(name)?.[1];
    if (id === undefined || activeIds.has(id)) {
      continue;
    }
    try {
      const fields = parseFrontMatter(fs.readFileSync(path.join(workDir, name), 'utf8'));
      const status = fields['status'] ?? '';
      if (status === 'todo' || status === 'planned' || status === 'blocked') {
        queued.push({ id, title: fields['title'] ?? '', status });
      }
    } catch {
      continue;
    }
  }
  return queued;
}

// Parses lines of `<unix-seconds>|<subject>` from `git log --format=%ct|%s`
// for the "merged today" list. Accepts both the old `board: T-XXXX merged`
// form and the new squash-merge form `T-XXXX: <summary>`; everything else
// (e.g. `work: ...`, `docs: ...`) is ignored. `git log` lists commits
// newest first, so the first line per task id wins and later duplicates
// are dropped.
export function parseMergedLog(stdout: string): { id: string; time: string }[] {
  const SQUASH = /^(\d+)\|T-(\d+):\s/;
  const BOARD = /^(\d+)\|board: T-(\d+) merged$/;
  const seen = new Map<string, { id: string; time: string }>();
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const match = SQUASH.exec(line) ?? BOARD.exec(line);
    if (match === null) {
      continue;
    }
    const seconds = match[1];
    const num = match[2];
    if (seconds === undefined || num === undefined) {
      continue;
    }
    const id = `T-${num}`;
    if (seen.has(id)) {
      continue;
    }
    seen.set(id, { id, time: new Date(Number(seconds) * 1000).toISOString() });
  }
  return [...seen.values()];
}

function mergedToday(deps: SnapshotDeps): MergedToday[] {
  const midnight = new Date(deps.now);
  midnight.setHours(0, 0, 0, 0);
  const result = deps.runner.run(deps.root, [
    'log',
    'main',
    '--first-parent',
    `--since=${midnight.toISOString()}`,
    '--format=%ct|%s',
  ]);
  if (!result.ok) {
    return [];
  }
  const entries: MergedToday[] = [];
  for (const { id, time } of parseMergedLog(result.stdout)) {
    const fields = readFields(deps.root, id);
    entries.push({
      id,
      time,
      summary: fields?.['title'] ?? '',
    });
  }
  return entries;
}

export async function collectSnapshot(deps: SnapshotDeps): Promise<Snapshot> {
  const active = await activeTasks(deps);
  return {
    generatedAt: new Date(deps.now).toISOString(),
    active,
    queued: queuedTasks(deps, new Set(active.map((task) => task.id))),
    mergedToday: mergedToday(deps),
  };
}
