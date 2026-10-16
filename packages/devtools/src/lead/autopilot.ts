// `lead/autopilot.ts` is split under `autopilot/` (T-1481): task info, worker
// actions plus sweep, and the doctor tick moved out unchanged. This file keeps
// the poll loop and re-exports the names it always exported.

export { extractCounts, extractVerdict } from './autopilot/task-info.js';

import { applyActions, maybeSweep } from './autopilot/actions.js';
import { tickDoctor } from './autopilot/doctor-tick.js';
import { prereviewInfo, readTaskInfo } from './autopilot/task-info.js';
import { type OpenCodeClient } from './client.js';
import { decide } from './decide.js';
import { currentHead, type GitRunner } from './git.js';
import { isGoPaused } from './go-pause.js';
import {
  parsePermission,
  summarizeSession,
  type ParsedPermission,
  type SessionState,
} from './session.js';
import { appendLog, loadState, updateState } from './state.js';
import { defaultSweepDeps, type SweepDeps } from './sweeper.js';
import type { TaskRecord } from './types.js';

export const POLL_MS = 15_000;
const MESSAGE_LIMIT = 30;

export interface AutopilotDeps {
  client: OpenCodeClient;
  runner: GitRunner;
  statePath: string;
  promptsDirPath: string;
  repoRoot: string;
  // Injected by runAutopilot (real OS by default). Tests that call tickOnce
  // directly leave it unset, so no real process is ever touched.
  sweeper?: SweepDeps;
}

export interface TickResult {
  escalations: string[];
  errors: string[];
}

// One poll over every worker session in the state file. Read-only when
// dryRun is set: it classifies and prints, but replies to nothing, prompts
// nobody, starts no sessions, and saves no state.
export async function tickOnce(
  deps: AutopilotDeps,
  options: { dryRun: boolean; now?: number },
): Promise<TickResult> {
  const result: TickResult = { escalations: [], errors: [] };
  const now = options.now ?? Date.now();
  const state = loadState(deps.statePath);
  try {
    await maybeSweep(state, deps, options.dryRun, now);
  } catch (error) {
    // The sweep must never break the task loop.
    const line = `sweeper: autopilot error: ${error instanceof Error ? error.message : String(error)}`;
    if (options.dryRun) {
      console.error(`DRY: ${line}`);
    } else {
      try {
        appendLog(deps.statePath, line);
      } catch {
        // Logging must never break the loop.
      }
    }
    result.errors.push(line);
  }
  const initialSessions = new Map<string, string>();
  for (const [task, record] of Object.entries(state.tasks)) {
    initialSessions.set(task, record.sessionId);
  }
  const updated = new Map<string, TaskRecord>();
  for (const task of Object.keys(state.tasks).sort()) {
    const record = state.tasks[task];
    if (record === undefined || record.role !== 'worker') {
      continue;
    }
    try {
      const rawPermissions = await deps.client.listPermissions(record.sessionId);
      const permissions = rawPermissions
        .map((entry) => parsePermission(entry))
        .filter((entry) => entry !== null);
      const summary = summarizeSession(
        await deps.client.listMessages(record.sessionId, MESSAGE_LIMIT),
      );
      const info = readTaskInfo(record.worktree, task);
      if (info === null) {
        const line = `${task}: task file is gone (worktree removed?); skipping`;
        if (options.dryRun) {
          console.error(`DRY: ${line}`);
        } else {
          appendLog(deps.statePath, line);
        }
        result.errors.push(line);
        continue;
      }
      const head = currentHead(deps.runner, record.worktree);
      const review = prereviewInfo(record.worktree);
      let prereviewSessionState: SessionState | 'none' = 'none';
      let prereviewPermissions: ParsedPermission[] = [];
      let prereviewQuotaError = false;
      let prereviewFailed = false;
      if (record.prereview !== undefined) {
        try {
          const summary = summarizeSession(
            await deps.client.listMessages(record.prereview.sessionId, 5),
          );
          prereviewSessionState = summary.state;
          prereviewQuotaError = summary.quotaError;
          prereviewFailed = summary.state === 'idle' && summary.outcome === 'failed';
        } catch {
          prereviewSessionState = 'unknown';
        }
        try {
          prereviewPermissions = (await deps.client.listPermissions(record.prereview.sessionId))
            .map((entry) => parsePermission(entry))
            .filter((entry) => entry !== null);
        } catch {
          prereviewPermissions = [];
        }
      }
      const actions = decide({
        now,
        task,
        worktree: record.worktree,
        record,
        sessionState: summary.state,
        quotaError: summary.quotaError,
        goPaused: isGoPaused(new Date(now)),
        questionRunning: summary.questionRunning,
        questionText: summary.questionText,
        questionIds: summary.questionIds,
        permissions,
        prereviewPermissions,
        taskStatus: info.status,
        taskFilePresent: true,
        blockedText: info.blockedText,
        head,
        prereviewFilePresent: review.present,
        prereviewVerdict: review.verdict,
        prereviewCounts: review.counts,
        prereviewSessionState,
        prereviewQuotaError,
        prereviewFailed,
      });
      if (options.dryRun) {
        for (const action of actions) {
          if (action.kind === 'escalate') {
            console.log(`DRY: would escalate: ${action.line}`);
          } else if (action.kind === 'reply-permission') {
            console.log(
              `DRY: would reply ${action.decision} to ${action.requestId} (${action.session})${action.message === undefined ? '' : ` (${action.message.slice(0, 80)})`}`,
            );
          } else if (action.kind === 'send-prompt') {
            console.log(`DRY: would send ${action.template} prompt to ${task}`);
          } else if (action.kind === 'fallback-model') {
            console.log(`DRY: would switch ${action.session} of ${task} to ${action.model}`);
          } else if (action.kind === 'start-prereview') {
            console.log(`DRY: would start pre-review for ${task} at ${action.head}`);
          }
        }
        continue;
      }
      updated.set(task, await applyActions(task, record, actions, deps, false, result));
    } catch (error) {
      const line = `${task}: autopilot error: ${error instanceof Error ? error.message : String(error)}`;
      if (options.dryRun) {
        console.error(`DRY: ${line}`);
      } else {
        try {
          appendLog(deps.statePath, line);
        } catch {
          // Logging must never break the loop.
        }
      }
      result.errors.push(line);
    }
  }
  if (!options.dryRun) {
    // Re-read the file so writes from other commands during the tick are
    // kept. A record is written back only when the task is still there with
    // the same session: a task merged or forgotten (gone) or relaunched (new
    // session) during the tick keeps what the file says. A forgotten task is
    // therefore never re-added, so the next tick neither resumes nor nudges it.
    updateState(deps.statePath, (fresh) => {
      for (const [task, record] of updated) {
        const current = fresh.tasks[task];
        if (current !== undefined && current.sessionId === initialSessions.get(task)) {
          fresh.tasks[task] = record;
        }
      }
    });
  }
  try {
    await tickDoctor(deps, { dryRun: options.dryRun, now });
  } catch (error) {
    // The doctor step must never break the task loop: a failure is logged
    // (or printed in dry-run) and the task results still stand.
    const line = `doctor: autopilot error: ${error instanceof Error ? error.message : String(error)}`;
    if (options.dryRun) {
      console.error(`DRY: ${line}`);
    } else {
      try {
        appendLog(deps.statePath, line);
      } catch {
        // Logging must never break the loop.
      }
    }
    result.errors.push(line);
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAutopilot(
  deps: AutopilotDeps,
  options: { once: boolean; dryRun: boolean },
): Promise<TickResult> {
  // The real sweeper is wired here, not in tickOnce, so unit tests that call
  // tickOnce directly never run `ps` or kill anything.
  const active: AutopilotDeps =
    deps.sweeper === undefined ? { ...deps, sweeper: defaultSweepDeps() } : deps;
  const combined: TickResult = { escalations: [], errors: [] };
  for (;;) {
    const tick = await tickOnce(active, { dryRun: options.dryRun });
    combined.escalations.push(...tick.escalations);
    combined.errors.push(...tick.errors);
    if (options.once) {
      return combined;
    }
    await sleep(POLL_MS);
  }
}
