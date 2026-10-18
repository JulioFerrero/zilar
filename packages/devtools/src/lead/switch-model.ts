import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import {
  readTaskFrontMatter,
  renderWorkerPrompt,
  startWorkerSession,
  worktreeFor,
} from './launch.js';
import { isGoPaused } from './go-pause.js';
import { loadRulesFile } from './prompts.js';
import { appendLog, loadState, updateState } from './state.js';
import { resolveWorkerVariant } from './model-schedule.js';
import { assertAllowedModel, splitModel } from './task-file.js';
import type { TaskRecord } from './types.js';

export interface SwitchModelDeps {
  repoRoot: string;
  client: OpenCodeClient;
  promptsDirPath: string;
  statePath: string;
}

// Resets per-session bookkeeping so the new model starts clean; `startedAt` stays,
// `switchedAt` records the handover.
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

// Re-targets a task's worker onto a new model: a fresh session in the same worktree,
// so work so far is kept. Never edits the task file or git.
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
  const worktree = worktreeFor(deps.repoRoot, task);
  if (!fs.existsSync(worktree)) {
    throw new Error(`worktree is missing for ${task}: ${worktree}`);
  }
  assertAllowedModel(newModel);
  const model = splitModel(newModel);
  const { file, branch } = readTaskFrontMatter(worktree, task);

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

  // Proceed only on ok, already-idle or not-found; anything else aborts before the
  // new session opens, since two writers in one worktree is worse than no switch.
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
  // Re-read right before writing so a mid-switch write is kept. Only this task's record
  // is touched, and only while it still points at the session the switch started from.
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

// Switches in place: the session keeps its context, as the autopilot fallback does.
export async function switchModelInPlace(
  task: string,
  newModel: string,
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
  const worktree = worktreeFor(deps.repoRoot, task);
  if (!fs.existsSync(worktree)) {
    throw new Error(`worktree is missing for ${task}: ${worktree}`);
  }
  assertAllowedModel(newModel);
  const { model: frontMatterModel, effort } = readTaskFrontMatter(worktree, task);
  const variant = resolveWorkerVariant(frontMatterModel, effort, new Date(), isGoPaused());

  await deps.client.switchModel(previous.sessionId, {
    ...splitModel(newModel),
    variant,
  });
  const now = new Date().toISOString();
  const previousSessionId = previous.sessionId;
  // Re-read right before writing; only the model and stamp change, guarded on the
  // session id like `switchModel`.
  updateState(deps.statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined && current.sessionId === previousSessionId) {
      fresh.tasks[task] = { ...current, model: newModel, switchedAt: now };
    }
  });
  appendLog(deps.statePath, `${task} switched worker to ${newModel} in place (lead)`);
  return { sessionId: previousSessionId, model: newModel };
}
