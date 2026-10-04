import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import {
  readTaskFrontMatter,
  renderWorkerPrompt,
  startWorkerSession,
  worktreeFor,
} from './launch.js';
import { loadRulesFile } from './prompts.js';
import { appendLog, loadState, updateState } from './state.js';
import { assertAllowedModel, splitModel } from './task-file.js';
import type { TaskRecord } from './types.js';

export interface SwitchModelDeps {
  repoRoot: string;
  client: OpenCodeClient;
  promptsDirPath: string;
  statePath: string;
}

// Resets the per-session bookkeeping so the autopilot treats this session as a
// fresh start: the new model has not seen this worker's nudges or quota
// errors, and any stalled state from the previous model must not carry over.
// `startedAt` is preserved (the task started on the same worktree), and we
// record `switchedAt` so the audit trail shows when the handover happened.
function resetRecordForSwitch(
  record: TaskRecord,
  sessionId: string,
  model: string,
  worktree: string,
  startedAt: string,
  switchedAt: string,
): TaskRecord {
  return {
    ...record,
    sessionId,
    model,
    worktree,
    startedAt,
    switchedAt,
    nudgesSent: 0,
    lastQuotaRetryAt: undefined,
    lastQuotaEscalatedAt: undefined,
    stalledEscalated: false,
    blockedEscalatedText: undefined,
    lastEscalation: undefined,
    escalatedPermissionIds: [],
    escalatedQuestionIds: [],
    prereviewStalledEscalated: false,
    packetReadyForHead: undefined,
    prereview: undefined,
  };
}

export interface SwitchModelResult {
  sessionId: string;
  model: string;
}

// Re-targets a tracked task's worker session onto a new model. The lead runs
// this when the previous model hit a quota error: we open a fresh session in
// the same worktree so the work so far (committed or not) is preserved, and
// point the state record at the new session. We must not edit the task file
// (the lead does that) and must not touch git.
export async function switchModel(
  task: string,
  newModel: string,
  extraRulesFile: string | undefined,
  deps: SwitchModelDeps,
): Promise<SwitchModelResult> {
  if (!/^T-\d+$/.test(task)) {
    throw new Error(`task must look like T-0038, got ${JSON.stringify(task)}`);
  }
  const state = loadState(deps.statePath);
  const previous = state.tasks[task];
  if (previous === undefined) {
    throw new Error(`unknown task ${task}: no session in the state file`);
  }
  if (previous.role !== 'worker') {
    throw new Error(`task ${task} is a ${previous.role} session, not a worker`);
  }
  // The worktree path is the same in the main checkout and in the worker's
  // worktree; the lead passes repoRoot.
  const worktree = worktreeFor(deps.repoRoot, task);
  if (!fs.existsSync(worktree)) {
    throw new Error(`worktree is missing for ${task}: ${worktree}`);
  }
  assertAllowedModel(newModel);
  const model = splitModel(newModel);
  const { file, branch } = readTaskFrontMatter(deps.repoRoot, task);

  const rules = loadRulesFile(path.join(deps.promptsDirPath, 'rules.json'));
  if (extraRulesFile !== undefined) {
    rules.push(...loadRulesFile(extraRulesFile));
  }
  // Every local check (rules files, the prompt template) runs before the
  // interrupt, so a typo never stops the old worker without a replacement.
  renderWorkerPrompt({
    promptsDirPath: deps.promptsDirPath,
    task,
    file,
    worktree,
    branch,
    template: 'switch',
  });

  // Interrupt the previous session. We only proceed past this point when the
  // outcome is one of: ok, already-idle, not-found. Any other failure aborts
  // the switch before we open the new session — two writers in one worktree
  // is worse than no switch at all. The lead's logger is informed of what
  // was ignored so the audit trail is honest.
  const outcome = await deps.client.tryInterrupt(previous.sessionId);
  if (outcome.kind === 'error') {
    throw new Error(
      `refusing to switch ${task}: cannot interrupt the previous session (${previous.sessionId}): ${outcome.message}`,
    );
  }
  if (outcome.kind === 'not_found') {
    appendLog(
      deps.statePath,
      `switch-model ${task}: previous session ${previous.sessionId} is gone, proceeding`,
    );
  } else if (outcome.kind === 'already_idle') {
    appendLog(
      deps.statePath,
      `switch-model ${task}: previous session ${previous.sessionId} was already idle, proceeding`,
    );
  }

  const { sessionId } = await startWorkerSession({
    client: deps.client,
    promptsDirPath: deps.promptsDirPath,
    task,
    file,
    worktree,
    branch,
    title: `${task} (${file}) [${newModel}]`,
    model,
    rules,
    template: 'switch',
  });
  const now = new Date().toISOString();
  const previousSessionId = previous.sessionId;
  const previousStartedAt = previous.startedAt;
  // Re-read right before writing so a tick's bookkeeping (or another
  // command) recorded mid-switch is kept. Only this task's record is
  // touched, and only when it still points at the session the switch
  // started from: a merge (gone) or relaunch (new session) mid-switch
  // keeps what the file says.
  updateState(deps.statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined && current.sessionId === previousSessionId) {
      fresh.tasks[task] = resetRecordForSwitch(
        current,
        sessionId,
        newModel,
        worktree,
        previousStartedAt,
        now,
      );
    }
  });
  return { sessionId, model: newModel };
}
