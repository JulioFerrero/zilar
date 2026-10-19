import path from 'node:path';
import type { OpenCodeClient } from './client.js';
import { isFreePaused, paidStep } from './free-pause.js';
import { isFreeListing } from './models.js';
import { isGoPaused } from './go-pause.js';
import { readTaskFrontMatter } from './launch.js';
import { resolveWorkerModel } from './model-schedule.js';
import { loadRulesFile } from './prompts.js';
import { freeSessionInUse, loadState, stateFilePath } from './state.js';
import { splitModel } from './task-file.js';
import type { TaskRecord } from './types.js';

// A new session starts without the old one's bookkeeping (nudges, quota errors,
// escalations); everything about the task itself is kept.
export function freshSessionRecord(
  record: TaskRecord,
  sessionId: string,
  model?: string,
): TaskRecord {
  return {
    ...record,
    sessionId,
    model: model ?? record.model,
    nudgesSent: 0,
    lastQuotaRetryAt: undefined,
    lastQuotaEscalatedAt: undefined,
    stalledEscalated: false,
    escalatedPermissionIds: [],
    escalatedQuestionIds: [],
  };
}

export interface FreshSessionDeps {
  client: OpenCodeClient;
  promptsDirPath: string;
  repoRoot: string;
  now?: () => Date;
  statePath?: string;
}

// Opens a fresh session in the task's existing worktree; the caller points the
// record at it. Never touches git or the state file.
export async function startFreshWorkerSession(
  deps: FreshSessionDeps,
  input: { task: string; record: TaskRecord; title: string; prompt: string },
): Promise<{ sessionId: string; model: string }> {
  const { model: frontMatterModel, effort } = readTaskFrontMatter(
    input.record.worktree,
    input.task,
  );
  // `model: auto` re-resolves when the fresh session starts, unless the free listings
  // are paused; other models keep the record's model.
  const now = deps.now?.() ?? new Date();
  const goPaused = isGoPaused(now);
  const freePaused = isFreePaused(now);
  const resolved = resolveWorkerModel(frontMatterModel, now, goPaused, freePaused);
  let modelString = frontMatterModel === 'auto' ? resolved.model : input.record.model;
  // One tracked session on a free listing at a time; the session this call replaces
  // does not count.
  if (
    isFreeListing(modelString) &&
    (freePaused ||
      freeSessionInUse(loadState(deps.statePath ?? stateFilePath()), {
        task: input.task,
        sessionId: input.record.sessionId,
      }))
  ) {
    modelString = paidStep(modelString, goPaused) ?? modelString;
  }
  const model = { ...splitModel(modelString), variant: resolved.effortOverride ?? effort };
  const rules = loadRulesFile(path.join(deps.promptsDirPath, 'rules.json'));
  const sessionId = await deps.client.createSession({
    title: input.title,
    agent: 'build',
    model,
    directory: input.record.worktree,
    permissions: rules,
  });
  deps.client.promptDetached(sessionId, input.prompt);
  return { sessionId, model: modelString };
}
