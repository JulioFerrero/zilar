import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { applyRecordPatch, decide, type Action } from './decide.js';
import { currentHead, type GitRunner } from './git.js';
import { findTaskFile } from './launch.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import {
  parsePermission,
  summarizeSession,
  type ParsedPermission,
  type SessionState,
} from './session.js';
import { startPrereviewSession } from './start-prereview.js';
import { appendLog, loadState, saveState } from './state.js';
import { extractBlockedText, parseFrontMatter } from './task-file.js';
import type { TaskRecord } from './types.js';

export const POLL_MS = 15_000;
const MESSAGE_LIMIT = 30;

export interface AutopilotDeps {
  client: OpenCodeClient;
  runner: GitRunner;
  statePath: string;
  promptsDirPath: string;
}

export interface TickResult {
  escalations: string[];
  errors: string[];
}

// The first line carrying a verdict out of PREREVIEW.md, for the packet-ready
// escalation. Falls back when the reviewer skipped it.
export function extractVerdict(text: string): string {
  const line = text.split('\n').find((candidate) => /verdict/i.test(candidate));
  return line === undefined ? '(no verdict line)' : line.trim();
}

function readTaskInfo(
  worktree: string,
  task: string,
): { file: string; status: string; branch: string; blockedText: string } | null {
  let file: string;
  try {
    file = findTaskFile(worktree, task);
  } catch {
    return null;
  }
  let text: string;
  try {
    text = fs.readFileSync(path.join(worktree, 'work', file), 'utf8');
  } catch {
    return null;
  }
  const fields = parseFrontMatter(text);
  return {
    file,
    status: fields['status'] ?? 'unknown',
    branch: fields['branch'] ?? '',
    blockedText: extractBlockedText(text),
  };
}

function prereviewInfo(worktree: string): { present: boolean; verdict: string } {
  const file = path.join(worktree, 'PREREVIEW.md');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { present: false, verdict: '' };
  }
  return { present: true, verdict: extractVerdict(text) };
}

async function applyActions(
  task: string,
  record: TaskRecord,
  actions: Action[],
  deps: AutopilotDeps,
  dryRun: boolean,
  result: TickResult,
): Promise<TaskRecord> {
  let current = record;
  const info = readTaskInfo(record.worktree, task);
  for (const action of actions) {
    if (action.kind === 'record') {
      current = applyRecordPatch(current, action.patch);
      continue;
    }
    if (action.kind === 'escalate') {
      result.escalations.push(action.line);
      if (!dryRun) {
        console.log(action.line);
        appendLog(deps.statePath, action.line);
      }
      continue;
    }
    if (dryRun) {
      continue;
    }
    if (action.kind === 'reply-permission') {
      const target = action.session === 'worker' ? current.sessionId : current.prereview?.sessionId;
      if (target === undefined) {
        continue;
      }
      await deps.client.replyPermission(target, action.requestId, action.decision, action.message);
      appendLog(
        deps.statePath,
        `${task} replied ${action.decision} to ${action.requestId} (${action.session})`,
      );
    } else if (action.kind === 'send-prompt') {
      const prompt = renderPrompt(loadPrompt(deps.promptsDirPath, action.template), {
        TASK: task,
        TASK_FILE: info?.file ?? `${task}.md`,
        WORKTREE: current.worktree,
        BRANCH: info?.branch ?? '',
      });
      deps.client.promptDetached(current.sessionId, prompt);
      appendLog(deps.statePath, `${task} sent ${action.template} prompt`);
    } else if (action.kind === 'start-prereview') {
      const sessionId = await startPrereviewSession(
        {
          client: deps.client,
          promptsDirPath: deps.promptsDirPath,
          worktree: current.worktree,
          task,
        },
        action.head,
      );
      current = {
        ...current,
        prereview: { sessionId, head: action.head, startedAt: new Date().toISOString() },
        prereviewStalledEscalated: false,
      };
      appendLog(deps.statePath, `${task} started pre-review ${sessionId} for ${action.head}`);
    }
  }
  return current;
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
      if (record.prereview !== undefined) {
        try {
          prereviewSessionState = summarizeSession(
            await deps.client.listMessages(record.prereview.sessionId, 5),
          ).state;
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
        prereviewSessionState,
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
          } else if (action.kind === 'start-prereview') {
            console.log(`DRY: would start pre-review for ${task} at ${action.head}`);
          }
        }
        continue;
      }
      state.tasks[task] = await applyActions(task, record, actions, deps, false, result);
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
    saveState(deps.statePath, state);
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
  const combined: TickResult = { escalations: [], errors: [] };
  for (;;) {
    const tick = await tickOnce(deps, { dryRun: options.dryRun });
    combined.escalations.push(...tick.escalations);
    combined.errors.push(...tick.errors);
    if (options.once) {
      return combined;
    }
    await sleep(POLL_MS);
  }
}
