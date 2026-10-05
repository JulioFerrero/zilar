import path from 'node:path';
import type { OpenCodeClient } from './client.js';
import { readTaskFrontMatter } from './launch.js';
import { resolveWorkerModel } from './model-schedule.js';
import { loadRulesFile } from './prompts.js';
import { splitModel } from './task-file.js';
import type { TaskRecord } from './types.js';

// A new worker session starts without the old session's bookkeeping: it has
// not been nudged, has seen no quota errors, and inherits no escalations.
// Everything describing the task itself (round count, pre-review, model,
// worktree, start time) is kept so the autopilot continues where it left off.
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
  // Injectable clock for tests of `model: auto` peak-hour resolution.
  now?: () => Date;
}

// Opens a fresh worker session in the task's existing worktree and sends it
// the given (already rendered) prompt. The old session is left alone —
// callers only use this when it is idle or already interrupted. Never touches
// git or the state file; the caller points the record at the new session.
export async function startFreshWorkerSession(
  deps: FreshSessionDeps,
  input: { task: string; record: TaskRecord; title: string; prompt: string },
): Promise<{ sessionId: string; model: string }> {
  const { model: frontMatterModel, effort } = readTaskFrontMatter(deps.repoRoot, input.task);
  // `model: auto` re-resolves at the time of the fresh session: a fix round in
  // DeepSeek's peak hours goes to the free Muse even if the first pass ran on
  // DeepSeek, and the other way around. Other models keep the record's model
  // (switch-model may have moved it).
  const resolved = resolveWorkerModel(frontMatterModel, deps.now?.() ?? new Date());
  const modelString = frontMatterModel === 'auto' ? resolved.model : input.record.model;
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
