import path from 'node:path';
import type { OpenCodeClient } from './client.js';
import { readTaskFrontMatter } from './launch.js';
import { loadRulesFile } from './prompts.js';
import { splitModel } from './task-file.js';
import type { TaskRecord } from './types.js';

// A new worker session starts without the old session's bookkeeping: it has
// not been nudged, has seen no quota errors, and inherits no escalations.
// Everything describing the task itself (round count, pre-review, model,
// worktree, start time) is kept so the autopilot continues where it left off.
export function freshSessionRecord(record: TaskRecord, sessionId: string): TaskRecord {
  return {
    ...record,
    sessionId,
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
}

// Opens a fresh worker session in the task's existing worktree and sends it
// the given (already rendered) prompt. The old session is left alone —
// callers only use this when it is idle or already interrupted. Never touches
// git or the state file; the caller points the record at the new session.
export async function startFreshWorkerSession(
  deps: FreshSessionDeps,
  input: { task: string; record: TaskRecord; title: string; prompt: string },
): Promise<string> {
  const { effort } = readTaskFrontMatter(deps.repoRoot, input.task);
  const model = { ...splitModel(input.record.model), variant: effort };
  const rules = loadRulesFile(path.join(deps.promptsDirPath, 'rules.json'));
  const sessionId = await deps.client.createSession({
    title: input.title,
    agent: 'build',
    model,
    directory: input.record.worktree,
    permissions: rules,
  });
  deps.client.promptDetached(sessionId, input.prompt);
  return sessionId;
}
