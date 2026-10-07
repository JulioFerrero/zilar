import { Effect, Schema, SchemaIssue } from 'effect';

// A permission rule sent to OpenCode at session creation. The last match wins,
// so general rules come first and exceptions after them. The command tool's
// action is `shell`, not `bash`: rules with `bash` silently never match.
export const permissionRuleSchema = Schema.Struct({
  action: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  resource: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  effect: Schema.Literals(['allow', 'ask', 'deny']),
});

export type PermissionRule = typeof permissionRuleSchema.Type;

export const permissionRulesSchema = Schema.mutable(Schema.Array(permissionRuleSchema));

// The front matter every task file carries. Only the fields the lead tools
// need are parsed; the rest of the file is free-form markdown.
export const taskFrontMatterSchema = Schema.Struct({
  id: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^T-\d+$/, { message: 'task id must look like T-0038' })),
  ),
  branch: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1, { message: 'branch is required' })),
  ),
  model: Schema.String.pipe(Schema.check(Schema.isMinLength(1, { message: 'model is required' }))),
  // Reasoning effort for the worker session; omitted = picked from the task (pickEffort).
  effort: Schema.optional(
    Schema.Literals(['minimal', 'low', 'medium', 'high', 'xhigh', 'default']),
  ),
  status: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

export type TaskFrontMatter = typeof taskFrontMatterSchema.Type;

// Flattens Effect Schema's issue tree into the same `path`/`message` entries
// the zod callers used to read, so error text keeps its exact format.
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

export function schemaIssues(error: Schema.SchemaError): { path: string; message: string }[] {
  return formatIssue(error.issue).issues.map((issue) => ({
    path: (issue.path ?? []).map(String).join('.'),
    message: issue.message,
  }));
}

// One entry in the lead state file. Bookkeeping fields let the autopilot act
// at most once per event (one escalation per permission, one pre-review per
// HEAD, two nudges) instead of repeating itself every 15 s poll.
export interface PrereviewRecord {
  sessionId: string;
  head: string;
  startedAt: string;
  model?: string | undefined;
}

// The doctor's last audit of main. Bookkeeping fields keep the one-line
// escalation per audited head instead of repeating it every 15 s poll.
export interface DoctorRecord {
  sessionId: string;
  head: string;
  since: string;
  startedAt: string;
  reportedForHead: string | undefined;
  stalledReportedForHead: string | undefined;
  model?: string | undefined;
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
  autoFixRounds: number;
  escalatedPermissionIds: string[];
  escalatedQuestionIds: string[];
  stalledEscalated: boolean;
  blockedEscalatedText: string | undefined;
  lastEscalation: string | undefined;
}

const nonnegativeInt = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);

const prereviewRecordSchema = Schema.Struct({
  sessionId: Schema.String,
  head: Schema.String,
  startedAt: Schema.String,
  model: Schema.optional(Schema.String),
});

const doctorRecordSchema = Schema.Struct({
  sessionId: Schema.String,
  head: Schema.String,
  since: Schema.String,
  startedAt: Schema.String,
  reportedForHead: Schema.optional(Schema.String),
  stalledReportedForHead: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
});

const taskRecordSchema = Schema.Struct({
  task: Schema.String,
  sessionId: Schema.String,
  worktree: Schema.String,
  model: Schema.String,
  role: Schema.Literals(['worker', 'prereview']),
  startedAt: Schema.String,
  switchedAt: Schema.optional(Schema.String),
  nudgesSent: nonnegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  lastQuotaRetryAt: Schema.optional(Schema.Number),
  lastQuotaEscalatedAt: Schema.optional(Schema.Number),
  prereview: Schema.optional(prereviewRecordSchema),
  packetReadyForHead: Schema.optional(Schema.String),
  prereviewStalledEscalated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  autoFixRounds: nonnegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  escalatedPermissionIds: Schema.mutable(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(Effect.succeed([] as string[])),
  ),
  escalatedQuestionIds: Schema.mutable(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(Effect.succeed([] as string[])),
  ),
  stalledEscalated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  blockedEscalatedText: Schema.optional(Schema.String),
  lastEscalation: Schema.optional(Schema.String),
});

// Unknown keys are stripped, not rejected: Effect Schema ignores excess
// properties by default, like zod's `z.object` did.
export const stateFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  tasks: Schema.Record(Schema.String, taskRecordSchema),
  doctor: Schema.optional(doctorRecordSchema),
});

export type StateFile = {
  version: 1;
  tasks: Record<string, TaskRecord>;
  doctor: DoctorRecord | undefined;
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
    autoFixRounds: 0,
    escalatedPermissionIds: [],
    escalatedQuestionIds: [],
    stalledEscalated: false,
    blockedEscalatedText: undefined,
    lastEscalation: undefined,
  };
}
