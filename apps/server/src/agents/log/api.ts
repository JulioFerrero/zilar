// T-1426: `GET /api/agents/tasks/:taskId/events` on the Effect `HttpApi`
// adapter. Owner only: an unknown task and a task owned by someone else answer
// the same 404, so existence is never leaked. The query is clamped in the
// handler (`after` defaults to 0, `limit` to 50, max 100).
import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { AgentTasksGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../../auth/auth';
import type { ServerDatabase } from '../../db/client';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../../effect/http-core';
import { HttpError } from '../../errors';
import { listTaskEvents, loadTaskOwnerId, normalizeLimit } from './read';
import { taskSteps } from './steps';

export interface AgentTasksApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: Logger;
}

const AgentTasksApi = HttpApi.make('agentTasks').add(AgentTasksGroup);

/** Reads the first value of a raw query key, ignoring repeats. */
function firstQuery(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

/** A non-negative integer, or `fallback` for anything else. */
function parseAfter(value: unknown): number {
  const raw = firstQuery(value);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseLimit(value: unknown): number {
  const raw = firstQuery(value);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return normalizeLimit(Number.isFinite(parsed) ? parsed : undefined);
}

export function createAgentTasksApi(deps: AgentTasksApiDependencies): EffectApiMount {
  const groupLayer = HttpApiBuilder.group(AgentTasksApi, 'agentTasks', (handlers) =>
    handlers
      .handle(
        'events',
        handler(deps.logger, (request, user) =>
          Effect.gen(function* () {
            const taskId = request.params.taskId;
            const ownerId = yield* Effect.promise(() => loadTaskOwnerId(deps.db, taskId));
            if (ownerId === null || ownerId !== user.id) {
              throw new HttpError(404, 'not_found', 'Task not found');
            }
            return yield* Effect.promise(() =>
              listTaskEvents(deps.db, {
                taskId,
                ownerId,
                after: parseAfter(request.query.after),
                limit: parseLimit(request.query.limit),
              }),
            );
          }),
        ),
      )
      .handle(
        'steps',
        handler(deps.logger, (request, user) =>
          Effect.gen(function* () {
            const taskId = request.params.taskId;
            const ownerId = yield* Effect.promise(() => loadTaskOwnerId(deps.db, taskId));
            if (ownerId === null || ownerId !== user.id) {
              throw new HttpError(404, 'not_found', 'Task not found');
            }
            // T-1530: the assembled "View steps" payload for the same owner.
            return yield* Effect.promise(() => taskSteps(deps.db, taskId));
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(AgentTasksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, deps.logger)),
  );

  return mountApi(AgentTasksApi, apiLayer);
}
