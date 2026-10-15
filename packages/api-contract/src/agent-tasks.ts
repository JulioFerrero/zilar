// T-1426: the session log behind the task card's "View steps". One task's
// events, oldest first, paged by `seq`. Owner only: the route answers the same
// 404 for an unknown task and for a task the caller may not see.
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from './middleware';
import { RawQueryValue } from './raw-query';

// Mirrors `TASK_EVENT_KINDS` in `apps/server/src/agents/log/append.ts`; the two
// lists are the wire contract and must stay in step.
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

/** One step. `data` holds ids, counts and redacted/truncated tool text only. */
export const TaskEvent = Schema.Struct({
  id: Schema.String,
  seq: Schema.Int,
  kind: TaskEventKind,
  at: Schema.String,
  durationMs: Schema.NullOr(Schema.Int),
  data: Schema.Record(Schema.String, Schema.Unknown),
});

export type TaskEvent = typeof TaskEvent.Type;

/** One page, oldest first; `next` is the `seq` to resume from, or null. */
export const TaskEventPage = Schema.Struct({
  events: Schema.Array(TaskEvent),
  next: Schema.NullOr(Schema.Int),
});

export type TaskEventPage = typeof TaskEventPage.Type;

// T-1530: one row of a step's activity — a tool call and its result, flattened
// to a short command plus its outcome. `error` is the stored (redacted and
// truncated) output, present only when the call failed.
export const TaskStepAction = Schema.Struct({
  command: Schema.String,
  ok: Schema.Boolean,
  durationMs: Schema.Int,
  error: Schema.optional(Schema.String),
});

export type TaskStepAction = typeof TaskStepAction.Type;

// T-1530: one card step. The steps mirror the card's list (title first, then
// `step-<n>`, capped at 20); `approved` is true when one of the step's actions
// raised an approval that was granted.
export const TaskStep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  state: Schema.Literals(['done', 'failed', 'stopped', 'doing']),
  durationMs: Schema.Int,
  approved: Schema.Boolean,
  actions: Schema.Array(TaskStepAction),
});

export type TaskStep = typeof TaskStep.Type;

/** The whole card's steps, in order. */
export const TaskSteps = Schema.Struct({
  steps: Schema.Array(TaskStep),
});

export type TaskSteps = typeof TaskSteps.Type;

const TaskIdParams = Schema.Struct({ taskId: Schema.String });

export const AgentTasksGroup = HttpApiGroup.make('agentTasks')
  .add(
    HttpApiEndpoint.get('events', '/agents/tasks/:taskId/events', {
      params: TaskIdParams,
      // Decoded by hand in the handler: the raw values always accept, so the
      // handler owns the clamping.
      query: { after: RawQueryValue, limit: RawQueryValue },
      success: TaskEventPage,
    }),
    // T-1530: the assembled "View steps" payload, owner only like `events`.
    HttpApiEndpoint.get('steps', '/agents/tasks/:taskId/steps', {
      params: TaskIdParams,
      success: TaskSteps,
    }),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
