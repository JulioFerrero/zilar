import fs from 'node:fs';
import path from 'node:path';
import type { OpenCodeClient } from '../client.js';
import {
  collectSnapshot,
  listSessionMessages,
  type GitCache,
  type MessageCache,
  type WorktreeGit,
} from '../collect-snapshot.js';
import type { GitRunner } from '../git.js';
import { findTaskFile } from '../launch.js';
import { loadState } from '../state.js';
import { parseFrontMatter } from '../task-file.js';
import { parseBoard } from '../../effect-map/generate.js';
import type { BoardRow } from '../../effect-map/generate.js';
import { parseChangedFiles } from './changed-files.js';
import type { ChangedFile } from './changed-files.js';
import { formatClock, formatDuration, modelLabel } from './format.js';
import { liveStep } from './live-step.js';
import { sessionSpeed } from './speed.js';
import type { SessionSpeed } from './speed.js';
import { chooseSessionId, isRunningPhase } from './view.js';
import type { WatchEntry, WatchView } from './view.js';

export async function collectFiles(
  runner: GitRunner,
  worktree: string,
  fallback: ChangedFile[],
  cached?: WorktreeGit,
): Promise<ChangedFile[]> {
  if (worktree === '' || !fs.existsSync(worktree)) {
    return fallback;
  }
  // A cached snapshot already carries the diff for the current HEAD, so no git runs here.
  if (cached !== undefined) {
    return cached.ok ? parseChangedFiles(cached.nameStatus, cached.porcelain) : fallback;
  }
  let nameStatus = '';
  let porcelain = '';
  try {
    const base = runner.run(worktree, ['merge-base', 'main', 'HEAD']);
    if (!base.ok) {
      return fallback;
    }
    const diff = runner.run(worktree, ['diff', '--name-status', base.stdout.trim()]);
    if (!diff.ok) {
      return fallback;
    }
    nameStatus = diff.stdout;
    const status = runner.run(worktree, ['status', '--porcelain']);
    if (status.ok) {
      porcelain = status.stdout;
    }
  } catch {
    return fallback;
  }
  return parseChangedFiles(nameStatus, porcelain);
}

// Reads `effort:` from the task's front matter, which the state file does not carry.
function readEffort(worktree: string, taskId: string): string | undefined {
  try {
    const file = findTaskFile(worktree, taskId);
    const text = fs.readFileSync(path.join(worktree, 'work', file), 'utf8');
    const fields = parseFrontMatter(text);
    return fields['effort'];
  } catch {
    return undefined;
  }
}

// The board's model column: the 4th cell of the task's row.
export function boardModelFor(boardText: string, id: string): string | undefined {
  const prefix = `| [${id}](`;
  const line = boardText.split('\n').find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    return undefined;
  }
  const model = line.split('|').map((cell) => cell.trim())[4] ?? '';
  return model === '' ? undefined : model;
}

interface BoardPhase {
  phaseId: string;
  needsLead: boolean;
}

function boardPhase(status: string): BoardPhase | null {
  if (status === 'in-progress') {
    return { phaseId: 'coding', needsLead: false };
  }
  if (status === 'review') {
    return { phaseId: 'waiting-lead', needsLead: true };
  }
  if (status === 'blocked') {
    return { phaseId: 'blocked', needsLead: true };
  }
  return null;
}

export interface BoardTaskFacts {
  row: BoardRow;
  model: string | undefined;
  effort: string | undefined;
  files: ChangedFile[];
  totalAge: string;
  step: string | null;
}

export function boardTaskEntry(facts: BoardTaskFacts): WatchEntry | null {
  const { row } = facts;
  const phase = boardPhase(row.status);
  if (phase === null) {
    return null;
  }
  const model = facts.model ?? 'unknown';
  return {
    id: row.id,
    title: row.title,
    modelLabel: modelLabel(model, facts.effort),
    model,
    effort: facts.effort,
    totalAge: facts.totalAge,
    autoFixRounds: 0,
    phaseId: phase.phaseId,
    phaseLabel: row.status,
    needsLead: phase.needsLead,
    running: row.status === 'in-progress',
    step: facts.step,
    files: facts.files,
    speed: null,
  };
}

function boardTotalAge(runner: GitRunner, worktree: string, now: number): string {
  const log = runner.run(worktree, ['log', '--reverse', '--format=%ct', 'main..HEAD']);
  const first = log.ok ? log.stdout.split('\n').find((line) => line.trim() !== '') : undefined;
  const committed = first === undefined ? Number.NaN : Number(first);
  const started = Number.isFinite(committed) ? committed * 1000 : fs.statSync(worktree).mtimeMs;
  return formatDuration((now - started) / 1000);
}

function boardStep(runner: GitRunner, worktree: string): string | null {
  const log = runner.run(worktree, ['log', '-1', '--format=%s', 'main..HEAD']);
  const subject = log.ok ? log.stdout.trim() : '';
  return subject === '' ? null : subject;
}

function readBoard(root: string): string {
  try {
    return fs.readFileSync(path.join(root, 'work', 'BOARD.md'), 'utf8');
  } catch {
    return '';
  }
}

async function boardOnlyEntries(
  root: string,
  hasRecord: (id: string) => boolean,
  runner: GitRunner,
  gitCache: GitCache,
  now: number,
): Promise<WatchEntry[]> {
  const boardText = readBoard(root);
  const entries: WatchEntry[] = [];
  for (const row of parseBoard(boardText)) {
    if (row.status === 'todo' || hasRecord(row.id)) {
      continue;
    }
    const worktree = path.join(path.dirname(root), `zilar-${row.id}`);
    if (!fs.existsSync(worktree)) {
      continue;
    }
    const entry = boardTaskEntry({
      row,
      model: boardModelFor(boardText, row.id),
      effort: readEffort(worktree, row.id),
      files: await collectFiles(runner, worktree, [], gitCache.get(worktree)),
      totalAge: boardTotalAge(runner, worktree, now),
      step: boardStep(runner, worktree),
    });
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

// Pulls everything the renderer needs in one pass. Errors flip `refreshFailed` so the
// header says so; the renderer keeps showing the previous data.
export async function buildView(
  previous: WatchView,
  root: string,
  statePath: string,
  client: OpenCodeClient,
  runner: GitRunner,
  gitCache: GitCache,
  now: number,
): Promise<WatchView> {
  const clock = formatClock(new Date(now));
  // One list per session for this refresh: `collectSnapshot` fills the cache and the
  // live-step read below reuses it instead of spawning `opencode2` again.
  const messages: MessageCache = new Map();
  let snapshot;
  try {
    snapshot = await collectSnapshot({
      client,
      runner,
      statePath,
      root,
      now,
      messages,
      gitCache,
    });
  } catch {
    return { ...previous, refreshFailed: true };
  }
  let state;
  try {
    state = loadState(statePath);
  } catch {
    return { ...previous, refreshFailed: true };
  }
  const entries: WatchEntry[] = [];
  for (const task of snapshot.active) {
    const record = state.tasks[task.id];
    if (record === undefined) {
      continue;
    }
    const phaseId = task.phase.id;
    const running = isRunningPhase(phaseId);
    const files = await collectFiles(runner, record.worktree, [], gitCache.get(record.worktree));
    const sessionId = chooseSessionId(phaseId, record.sessionId, record.prereview?.sessionId);
    let step: string | null = null;
    let speed: SessionSpeed | null = null;
    if (running) {
      try {
        const list = await listSessionMessages(client, messages, sessionId, 20);
        step = liveStep(list);
        speed = sessionSpeed(list);
      } catch {
        step = null;
        speed = null;
      }
    }
    const effort = readEffort(record.worktree, task.id);
    entries.push({
      id: task.id,
      title: task.title,
      modelLabel: modelLabel(record.model, effort),
      model: record.model,
      effort,
      totalAge: task.totalAge,
      autoFixRounds: task.autoFixRounds,
      phaseId,
      phaseLabel: task.phase.label,
      needsLead: task.phase.needsLead,
      running,
      step,
      files,
      speed,
    });
  }
  entries.push(
    ...(await boardOnlyEntries(root, (id) => state.tasks[id] !== undefined, runner, gitCache, now)),
  );
  return { clock, refreshFailed: false, mergedToday: snapshot.mergedToday.length, entries };
}
