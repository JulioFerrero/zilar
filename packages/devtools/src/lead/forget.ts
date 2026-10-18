import fs from 'node:fs';
import { OpencodeCliClient, type OpenCodeClient } from './client.js';
import { summarizeSession, type SessionState } from './session.js';
import { appendLog, loadState, stateFilePath, updateState } from './state.js';
import { taskStatusOf } from './status.js';

// A task in one of these statuses still has work ahead of it: forget refuses
// to drop it even when it is named.
const ACTIVE_STATUSES = new Set(['todo', 'in-progress', 'review']);

const FINISHED_STATUSES = new Set(['merged', '(missing)', 'eval-done', 'eval-stopped', 'eval-dq']);

export interface ForgetDeps {
  client: OpenCodeClient;
  statePath: string;
}

export interface ForgetOptions {
  tasks: string[];
  finished: boolean;
  dryRun: boolean;
}

const USAGE = 'usage: lead forget <T-XXXX> [...] | lead forget --finished [--dry-run]';

async function sessionState(deps: ForgetDeps, sessionId: string): Promise<SessionState> {
  try {
    return summarizeSession(await deps.client.listMessages(sessionId, 5)).state;
  } catch {
    return 'unknown';
  }
}

// Why a task may not be forgotten, or null when it is safe. A running session is busy;
// an unreadable one might be, so it is refused too.
function refusalReason(status: string, session: SessionState): string | null {
  if (ACTIVE_STATUSES.has(status)) {
    return `task status is ${status}`;
  }
  if (session === 'running') {
    return 'session is running';
  }
  if (session === 'unknown') {
    return 'session state could not be read';
  }
  return null;
}

async function forgetNamed(deps: ForgetDeps, taskIds: string[], dryRun: boolean): Promise<void> {
  const state = loadState(deps.statePath);
  const removed: string[] = [];
  const lines: string[] = [];
  for (const task of taskIds) {
    const record = state.tasks[task];
    if (record === undefined) {
      lines.push(`${task}: not tracked`);
      continue;
    }
    const status = taskStatusOf(record.worktree, task);
    const session = await sessionState(deps, record.sessionId);
    const refusal = refusalReason(status, session);
    if (refusal !== null) {
      lines.push(`${task}: refused, ${refusal}`);
      continue;
    }
    removed.push(task);
    lines.push(`${task}: forgot (status ${status}, session ${session})`);
  }
  for (const line of lines) {
    console.log(dryRun ? `DRY: ${line}` : line);
  }
  if (!dryRun && removed.length > 0) {
    updateState(deps.statePath, (fresh) => {
      for (const task of removed) {
        delete fresh.tasks[task];
      }
    });
    for (const task of removed) {
      appendLog(deps.statePath, `forget ${task}: dropped from the state file`);
    }
  }
}

// Every entry whose worktree is gone or task is over and whose session is idle.
async function selectFinished(deps: ForgetDeps, taskIds: string[]): Promise<string[]> {
  const state = loadState(deps.statePath);
  const selected: string[] = [];
  for (const task of taskIds) {
    const record = state.tasks[task];
    if (record === undefined) {
      continue;
    }
    const status = taskStatusOf(record.worktree, task);
    const worktreeGone = !fs.existsSync(record.worktree);
    if (!worktreeGone && !FINISHED_STATUSES.has(status)) {
      continue;
    }
    if ((await sessionState(deps, record.sessionId)) !== 'idle') {
      continue;
    }
    selected.push(task);
  }
  return selected;
}

export async function forgetTasks(deps: ForgetDeps, options: ForgetOptions): Promise<void> {
  if (options.finished) {
    if (options.tasks.length > 0) {
      throw new Error(USAGE);
    }
    const state = loadState(deps.statePath);
    const selected = await selectFinished(deps, Object.keys(state.tasks).sort());
    if (selected.length === 0) {
      console.log(options.dryRun ? 'DRY: nothing to forget' : 'nothing to forget');
      return;
    }
    console.log(`${options.dryRun ? 'DRY: would forget' : 'forgot'} ${selected.join(', ')}`);
    console.log(`${options.dryRun ? 'DRY: would remove' : 'removed'} ${selected.length} task(s)`);
    if (!options.dryRun) {
      updateState(deps.statePath, (fresh) => {
        for (const task of selected) {
          delete fresh.tasks[task];
        }
      });
      for (const task of selected) {
        appendLog(deps.statePath, `forget ${task}: finished`);
      }
    }
    return;
  }
  if (options.tasks.length === 0) {
    throw new Error(USAGE);
  }
  await forgetNamed(deps, options.tasks, options.dryRun);
}

export async function runForget(positional: string[], args: string[]): Promise<void> {
  await forgetTasks(
    { client: new OpencodeCliClient(), statePath: stateFilePath() },
    {
      tasks: positional,
      finished: args.includes('--finished'),
      dryRun: args.includes('--dry-run'),
    },
  );
}
