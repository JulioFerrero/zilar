// Owner only: an unknown task and a task the caller may not see answer the same 404.
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from './middleware';
import { RawQueryValue } from './raw-query';

// Mirrors `TASK_EVENT_KINDS` in `apps/server/src/agents/log/append.ts`; the two lists are the wire contract and must stay in step.
export const TASK_EVENT_KINDS = [
  'status',
  'model_call',
  'tool_call',
  'tool_result',
  'approval',
  'answer',
  'error',
] as const;

export const TaskEventKind = Schema.Literals(TASK_EVENT_KINDS);

export type TaskEventKind = typeof TaskEventKind.Type;

// `data` holds ids, counts and redacted/truncated tool text only.
export const TaskEvent = Schema.Struct({
  id: Schema.String,
  seq: Schema.Int,
  kind: TaskEventKind,
  at: Schema.String,
  durationMs: Schema.NullOr(Schema.Int),
  data: Schema.Record(Schema.String, Schema.Unknown),
});

export type TaskEvent = typeof TaskEvent.Type;

export const TaskEventPage = Schema.Struct({
  events: Schema.Array(TaskEvent),
  next: Schema.NullOr(Schema.Int),
});

export type TaskEventPage = typeof TaskEventPage.Type;

export const TaskStepAction = Schema.Struct({
  command: Schema.String,
  ok: Schema.Boolean,
  durationMs: Schema.Int,
  error: Schema.optional(Schema.String),
});

export type TaskStepAction = typeof TaskStepAction.Type;

export const TaskStep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  state: Schema.Literals(['done', 'failed', 'stopped', 'doing']),
  durationMs: Schema.Int,
  approved: Schema.Boolean,
  actions: Schema.Array(TaskStepAction),
});

export type TaskStep = typeof TaskStep.Type;

export const TaskSteps = Schema.Struct({
  steps: Schema.Array(TaskStep),
});

export type TaskSteps = typeof TaskSteps.Type;

const TaskIdParams = Schema.Struct({ taskId: Schema.String });

export const AgentTasksGroup = HttpApiGroup.make('agentTasks')
  .add(
    HttpApiEndpoint.get('events', '/agents/tasks/:taskId/events', {
      params: TaskIdParams,
      // Decoded by hand in the handler: the raw values always accept, so the handler owns the clamping.
      query: { after: RawQueryValue, limit: RawQueryValue },
      success: TaskEventPage,
    }),
    HttpApiEndpoint.get('steps', '/agents/tasks/:taskId/steps', {
      params: TaskIdParams,
      success: TaskSteps,
    }),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
