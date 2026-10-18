import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { AgentTasksGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../../auth/auth';
import type { ServerDatabase } from '../../db/client';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../../effect/http-core';
import { HttpError } from '../../errors';
import { taskSteps } from './steps';
import { SqlClient } from 'effect/sql';
import type { AgentTaskEventRow } from '../../db/rows';
import { runSql } from '../../effect/sql';
import type { TaskEventKind } from './append';

/** One event as the API returns it. */
interface TaskEventDto {
  id: string;
  seq: number;
  kind: TaskEventKind;
  at: string;
  durationMs: number | null;
  data: Record<string, unknown>;
}

interface TaskEventPage {
  events: TaskEventDto[];
  next: number | null;
}

/** The default page size and the hard cap. */
const TASK_EVENTS_DEFAULT_LIMIT = 50;
const TASK_EVENTS_MAX_LIMIT = 100;

/** Clamps a requested limit into `[1, TASK_EVENTS_MAX_LIMIT]`. */
function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return TASK_EVENTS_DEFAULT_LIMIT;
  }
  return Math.min(TASK_EVENTS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** The owner id of a task id, or `null` when no event exists for it. */
export async function loadTaskOwnerId(db: ServerDatabase, taskId: string): Promise<string | null> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ ownerId: string }>`SELECT owner_id FROM agent_task_events
        WHERE task_id = ${taskId} ORDER BY seq ASC LIMIT 1`;
    }),
  );
  return rows[0]?.ownerId ?? null;
}

function eventOf(row: AgentTaskEventRow): TaskEventDto {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind as TaskEventKind,
    at: new Date(row.at).toISOString(),
    durationMs: row.durationMs,
    data: row.data,
  };
}

/** One page of a task's events after `after`, oldest first. */
export async function listTaskEvents(
  db: ServerDatabase,
  input: { taskId: string; ownerId: string; after: number; limit: number },
): Promise<TaskEventPage> {
  const limit = normalizeLimit(input.limit);
  // Fetch one extra row so a full page can carry the next cursor.
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AgentTaskEventRow>`SELECT id, task_id, ai_id, owner_id, chat_jid,
          seq, kind, at, duration_ms, data
        FROM agent_task_events
        WHERE task_id = ${input.taskId} AND owner_id = ${input.ownerId} AND seq > ${input.after}
        ORDER BY seq ASC LIMIT ${limit + 1}`;
    }),
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore ? (page[page.length - 1]?.seq ?? null) : null;
  return { events: page.map(eventOf), next };
}
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
