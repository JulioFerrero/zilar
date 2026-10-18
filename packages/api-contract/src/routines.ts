// Pause and resume answer the same shape without the id fields, so those are optional.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { SchemaErrors, Session } from './middleware';

export const Routine = Schema.Struct({
  id: Schema.String,
  aiId: Schema.optional(Schema.String),
  groupId: Schema.optional(Schema.NullOr(Schema.String)),
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(Schema.Literals(['tool', 'prompt'])),
  toolId: Schema.optional(Schema.String),
  title: Schema.String,
  toolName: Schema.String,
  schedule: Schema.Unknown,
  status: Schema.Literals(['active', 'paused', 'needs_approval']),
  pausedReason: Schema.NullOr(Schema.Literals(['user', 'failures', 'hosts_changed'])),
  nextRunAt: Schema.String,
  lastRunAt: Schema.NullOr(Schema.String),
  lastStatus: Schema.NullOr(Schema.Literals(['ok', 'error', 'skipped'])),
  approvedHosts: Schema.mutable(Schema.Array(Schema.String)),
  scope: Schema.optional(Schema.Literals(['personal', 'group'])),
});

export type Routine = typeof Routine.Type;

export const MyRoutine = Schema.Struct({
  ...Routine.fields,
  aiName: Schema.String,
  aiAvatarUrl: Schema.optional(Schema.String),
  chatName: Schema.NullOr(Schema.String),
  // A group routine carries its topic's room JID, a personal one the AI's own DM JID; null only when the server has no MUC domain.
  chatJid: Schema.NullOr(Schema.String),
});

export type MyRoutine = typeof MyRoutine.Type;

const RoutineIdParams = Schema.Struct({ id: Schema.String });

export const RoutinesGroup = HttpApiGroup.make('routines')
  .add(
    HttpApiEndpoint.get('listMine', '/routines', {
      success: Schema.Array(MyRoutine),
    }),
    HttpApiEndpoint.get('listForAi', '/ais/:id/routines', {
      params: RoutineIdParams,
      success: Schema.Array(Routine),
    }),
    HttpApiEndpoint.get('listForGroup', '/groups/:id/routines', {
      params: RoutineIdParams,
      success: Schema.Array(Routine),
    }),
    HttpApiEndpoint.get('listForTopic', '/topics/:id/routines', {
      params: RoutineIdParams,
      success: Schema.Array(Routine),
    }),
    HttpApiEndpoint.post('pause', '/routines/:id/pause', {
      params: RoutineIdParams,
      success: Routine,
    }),
    HttpApiEndpoint.post('resume', '/routines/:id/resume', {
      params: RoutineIdParams,
      success: Routine,
    }),
    HttpApiEndpoint.delete('remove', '/routines/:id', {
      params: RoutineIdParams,
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
