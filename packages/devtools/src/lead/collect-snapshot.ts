import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { type GitRunner } from './git.js';
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
import { readWorktreeGit, type GitCache } from './worktree-git.js';

export {
  loadGitCache,
  readWorktreeGit,
  saveGitCache,
  type GitCache,
  type WorktreeGit,
} from './worktree-git.js';

export interface SnapshotDeps {
  client: OpenCodeClient;
  runner: GitRunner;
  statePath: string;
  root: string;
  now: number;
  /** Per-refresh `session.message.list` results, shared with `buildView`. */
  messages?: MessageCache | undefined;
  gitCache?: GitCache | undefined;
}

// A per-refresh cache of `session.message.list` results; `buildView` reuses them
// instead of spawning `opencode2` again, and a larger request can grow an entry.
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
        // 20, not 5: the same list later serves `buildView`'s live step and speed line.
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

// Parses `<unix-seconds>|<subject>` from `git log --format=%ct|%s` for the "merged
// today" list; accepts `board: T-XXXX merged` and `T-XXXX: <summary>`, newest first
// so the first line per task id wins.
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
