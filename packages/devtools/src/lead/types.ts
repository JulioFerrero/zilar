import { z } from 'zod';

// A permission rule sent to OpenCode at session creation. The last match wins,
// so general rules come first and exceptions after them. The command tool's
// action is `shell`, not `bash`: rules with `bash` silently never match.
export const permissionRuleSchema = z.object({
  action: z.string().min(1),
  resource: z.string().min(1),
  effect: z.enum(['allow', 'ask', 'deny']),
});

export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const permissionRulesSchema = z.array(permissionRuleSchema);

// The front matter every task file carries. Only the fields the lead tools
// need are parsed; the rest of the file is free-form markdown.
export const taskFrontMatterSchema = z.object({
  id: z.string().regex(/^T-\d+$/, 'task id must look like T-0038'),
  branch: z.string().min(1, 'branch is required'),
  model: z.string().min(1, 'model is required'),
  // Reasoning effort for the worker session; omitted = picked from the task (pickEffort).
  effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'default']).optional(),
  status: z.string().min(1),
});

export type TaskFrontMatter = z.infer<typeof taskFrontMatterSchema>;

// One entry in the lead state file. Bookkeeping fields let the autopilot act
// at most once per event (one escalation per permission, one pre-review per
// HEAD, two nudges) instead of repeating itself every 15 s poll.
export interface PrereviewRecord {
  sessionId: string;
  head: string;
  startedAt: string;
}

export interface TaskRecord {
  task: string;
  sessionId: string;
  worktree: string;
  model: string;
  role: 'worker' | 'prereview';
  startedAt: string;
  switchedAt: string | undefined;
  nudgesSent: number;
  lastQuotaRetryAt: number | undefined;
  lastQuotaEscalatedAt: number | undefined;
  prereview: PrereviewRecord | undefined;
  packetReadyForHead: string | undefined;
  prereviewStalledEscalated: boolean;
  escalatedPermissionIds: string[];
  escalatedQuestionIds: string[];
  stalledEscalated: boolean;
  blockedEscalatedText: string | undefined;
  lastEscalation: string | undefined;
}

const prereviewRecordSchema = z.object({
  sessionId: z.string(),
  head: z.string(),
  startedAt: z.string(),
});

const taskRecordSchema = z.object({
  task: z.string(),
  sessionId: z.string(),
  worktree: z.string(),
  model: z.string(),
  role: z.enum(['worker', 'prereview']),
  startedAt: z.string(),
  switchedAt: z.string().optional(),
  nudgesSent: z.number().int().nonnegative().default(0),
  lastQuotaRetryAt: z.number().optional(),
  lastQuotaEscalatedAt: z.number().optional(),
  prereview: prereviewRecordSchema.optional(),
  packetReadyForHead: z.string().optional(),
  prereviewStalledEscalated: z.boolean().default(false),
  escalatedPermissionIds: z.array(z.string()).default([]),
  escalatedQuestionIds: z.array(z.string()).default([]),
  stalledEscalated: z.boolean().default(false),
  blockedEscalatedText: z.string().optional(),
  lastEscalation: z.string().optional(),
});

export const stateFileSchema = z.object({
  version: z.literal(1),
  tasks: z.record(z.string(), taskRecordSchema),
});

export type StateFile = {
  version: 1;
  tasks: Record<string, TaskRecord>;
};

export function newTaskRecord(init: {
  task: string;
  sessionId: string;
  worktree: string;
  model: string;
  role: 'worker' | 'prereview';
  startedAt: string;
}): TaskRecord {
  return {
    ...init,
    switchedAt: undefined,
    nudgesSent: 0,
    lastQuotaRetryAt: undefined,
    lastQuotaEscalatedAt: undefined,
    prereview: undefined,
    packetReadyForHead: undefined,
    prereviewStalledEscalated: false,
    escalatedPermissionIds: [],
    escalatedQuestionIds: [],
    stalledEscalated: false,
    blockedEscalatedText: undefined,
    lastEscalation: undefined,
  };
}
