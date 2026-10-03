import fs from 'node:fs';
import path from 'node:path';
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
      const messages = await deps.client.listMessages(record.sessionId, 30);
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
        prereviewState = summarizeSession(
          await deps.client.listMessages(record.prereview.sessionId, 5),
        ).state;
      } catch {
        prereviewState = 'unknown';
      }
    }
    const head = currentHead(deps.runner, record.worktree);
    const reviewFile = path.join(record.worktree, 'PREREVIEW.md');
    const phase = derivePhase({
      taskStatus: fields['status'] ?? '',
      sessionState,
      quotaError,
      autoFixRounds: record.autoFixRounds,
      prereviewForHead: head !== undefined && record.prereview?.head === head,
      prereviewSessionState: prereviewState,
      prereviewFilePresent: fs.existsSync(reviewFile),
      packetReady: head !== undefined && record.packetReadyForHead === head,
    });
    const startedMs = Date.parse(record.startedAt) || 0;
    const commitMs = lastCommitMs(deps.runner, record.worktree);
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
      commits: commitsAhead(deps.runner, record.worktree),
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

function mergedToday(deps: SnapshotDeps): MergedToday[] {
  const midnight = new Date(deps.now);
  midnight.setHours(0, 0, 0, 0);
  const result = deps.runner.run(deps.root, [
    'log',
    'main',
    `--since=${midnight.toISOString()}`,
    '--grep=^board: T-.* merged$',
    '--format=%ct|%s',
  ]);
  if (!result.ok) {
    return [];
  }
  const entries: MergedToday[] = [];
  for (const line of result.stdout.split('\n')) {
    const match = /^(\d+)\|board: (T-\d+) merged$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    const id = match[2] ?? '';
    const fields = readFields(deps.root, id);
    entries.push({
      id,
      time: new Date(Number(match[1]) * 1000).toISOString(),
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
