// Routines module on the Effect `HttpApi` adapter (T-0554): the same
// methods, paths, statuses (204 on delete), bodies, audit calls and step
// order as the old Hono router (`routes.ts`), which has since been deleted
// along with its thin wrapper; mounted under Hono by
// `apps/server/src/effect/http.ts`. The module's own
// reads run on effect/sql; the calls it still makes to the service stay
// drizzle for now (the DB rewrite is a separate lane).

import { Effect, Layer, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import { HttpError } from '../errors';
import { canSeeTopic, type TopicRow } from '../topics/access';
import {
  deleteRoutine,
  getRoutine,
  listRoutinesForAi,
  listRoutinesForTopic,
  pauseRoutine,
  resumeRoutine,
  RoutineServiceError,
  type PublicRoutine,
  type RoutineRow,
} from './service';
import { runSql } from './db';

const RoutineStatus = Schema.Literals(['active', 'paused', 'needs_approval']);
const RoutinePausedReason = Schema.NullOr(Schema.Literals(['user', 'failures', 'hosts_changed']));
const RoutineLastStatus = Schema.NullOr(Schema.Literals(['ok', 'error', 'skipped']));
const RoutineScope = Schema.Literals(['personal', 'group']);

// The list shape is the full `PublicRoutine`: every field, dates as the
// ISO strings `c.json` used to write.
const RoutineListItem = Schema.Struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  toolId: Schema.String,
  toolName: Schema.String,
  title: Schema.String,
  schedule: Schema.Unknown,
  status: RoutineStatus,
  pausedReason: RoutinePausedReason,
  nextRunAt: Schema.String,
  lastRunAt: Schema.NullOr(Schema.String),
  lastStatus: RoutineLastStatus,
  approvedHosts: Schema.Array(Schema.String),
  scope: RoutineScope,
});

const RoutineList = Schema.Array(RoutineListItem);

// The pause/resume shape is the old `toWire` view: no ai/group/topic/tool
// ids, dates as ISO strings.
const RoutineDetail = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  toolName: Schema.String,
  schedule: Schema.Unknown,
  status: RoutineStatus,
  pausedReason: RoutinePausedReason,
  nextRunAt: Schema.String,
  lastRunAt: Schema.NullOr(Schema.String),
  lastStatus: RoutineLastStatus,
  approvedHosts: Schema.Array(Schema.String),
  scope: RoutineScope,
});

const RoutineIdParams = Schema.Struct({ id: Schema.String });

// A params decode failure renders like the old zod path: a 400
// `invalid_request`. Params are plain strings so this never fires; the
// layer exists so the group middleware reads like the other modules.
class RoutinesSchemaErrors extends HttpApiMiddleware.Service<RoutinesSchemaErrors>()(
  'zilar/effect/http/RoutinesSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<RoutinesSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(RoutinesSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

const RoutinesGroup = HttpApiGroup.make('routines')
  .add(
    HttpApiEndpoint.get('listForAi', '/ais/:id/routines', {
      params: RoutineIdParams,
      success: RoutineList,
    }),
    HttpApiEndpoint.get('listForGroup', '/groups/:id/routines', {
      params: RoutineIdParams,
      success: RoutineList,
    }),
    HttpApiEndpoint.post('pause', '/routines/:id/pause', {
      params: RoutineIdParams,
      success: RoutineDetail,
    }),
    HttpApiEndpoint.post('resume', '/routines/:id/resume', {
      params: RoutineIdParams,
      success: RoutineDetail,
    }),
    HttpApiEndpoint.delete('remove', '/routines/:id', {
      params: RoutineIdParams,
      success: Schema.Void,
    }),
  )
  .middleware(Session)
  .middleware(RoutinesSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const RoutinesApi = HttpApi.make('routines').add(RoutinesGroup);

export interface RoutinesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: Logger;
  audit?: AuditRecorder;
  /** Injected in tests so pause/resume/delete timestamps can advance. */
  now?: () => Date;
}

export const ROUTINES_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/ais/:id/routines' },
  { method: 'GET', path: '/api/groups/:id/routines' },
  { method: 'POST', path: '/api/routines/:id/pause' },
  { method: 'POST', path: '/api/routines/:id/resume' },
  { method: 'DELETE', path: '/api/routines/:id' },
];

export function createRoutinesApi(deps: RoutinesApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? (() => new Date());

  const groupLayer = HttpApiBuilder.group(RoutinesApi, 'routines', (handlers) =>
    handlers
      .handle('listForAi', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const ai = yield* Effect.promise(() =>
              findOwnedAiRow(deps.db, request.params.id, user.id),
            );
            if (!ai) {
              throw new HttpError(404, 'not_found', 'AI not found');
            }
            // Only routines of topics the owner can see: a routine in a
            // private topic the owner was removed from stays hidden until
            // they are back.
            const all = yield* Effect.promise(() => listRoutinesForAi(deps.db, ai.id));
            const visible: PublicRoutine[] = [];
            for (const routine of all) {
              if (routine.topicId === null) {
                visible.push(routine);
                continue;
              }
              const topicId = routine.topicId;
              const topic = yield* Effect.promise(() => findTopicById(deps.db, topicId));
              if (topic && (yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))) {
                visible.push(routine);
              }
            }
            return visible.map(toListWire);
          }),
          logger,
          requestId,
        );
      })
      .handle('listForGroup', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const groupId = request.params.id;
            const membership = yield* Effect.promise(() =>
              findMembership(deps.db, groupId, user.id),
            );
            if (!membership) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            // Only routines of topics the viewer can see.
            const topicRows = yield* Effect.promise(() => listTopicsByGroup(deps.db, groupId));
            const result: PublicRoutine[] = [];
            for (const topic of topicRows) {
              if (topic.archivedAt !== null) {
                continue;
              }
              if (!(yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))) {
                continue;
              }
              const rows = yield* Effect.promise(() => listRoutinesForTopic(deps.db, topic.id));
              for (const routine of rows) {
                result.push(routine);
              }
            }
            return result.map(toListWire);
          }),
          logger,
          requestId,
        );
      })
      .handle('pause', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const access = yield* Effect.promise(() =>
              routineAccess(deps.db, request.params.id, user.id),
            );
            if (!access || !access.manager) {
              throw new HttpError(404, 'not_found', 'Routine not found');
            }
            yield* withServiceErrors(() =>
              pauseRoutine(deps.db, access.routine.id, user.id, now(), deps.audit),
            );
            const found = yield* Effect.promise(() => getRoutine(deps.db, access.routine.id));
            if (!found) {
              throw new HttpError(404, 'not_found', 'Routine not found');
            }
            return toDetailWire(found.routine, found.toolName);
          }),
          logger,
          requestId,
        );
      })
      .handle('resume', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const access = yield* Effect.promise(() =>
              routineAccess(deps.db, request.params.id, user.id),
            );
            if (!access || !access.manager) {
              throw new HttpError(404, 'not_found', 'Routine not found');
            }
            yield* withServiceErrors(() =>
              resumeRoutine(deps.db, access.routine.id, user.id, now(), deps.audit),
            );
            const found = yield* Effect.promise(() => getRoutine(deps.db, access.routine.id));
            if (!found) {
              throw new HttpError(404, 'not_found', 'Routine not found');
            }
            return toDetailWire(found.routine, found.toolName);
          }),
          logger,
          requestId,
        );
      })
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const routineId = request.params.id;
            // Like the tools delete: managers resolve on the raw row
            // (including soft-deleted ones) so a re-delete answers 204;
            // strangers still get the missing-id 404.
            const access = yield* Effect.promise(() =>
              routineAccessIncludingDeleted(deps.db, routineId, user.id),
            );
            if (!access || !access.manager) {
              throw new HttpError(404, 'not_found', 'Routine not found');
            }
            yield* Effect.promise(() =>
              deleteRoutine(deps.db, routineId, user.id, now(), deps.audit),
            );
            return HttpServerResponse.empty({ status: 204 });
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(RoutinesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: ROUTINES_API_ROUTES };
}

function toListWire(routine: PublicRoutine) {
  return {
    id: routine.id,
    aiId: routine.aiId,
    groupId: routine.groupId,
    topicId: routine.topicId,
    toolId: routine.toolId,
    toolName: routine.toolName,
    title: routine.title,
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt.toISOString(),
    lastRunAt: routine.lastRunAt === null ? null : routine.lastRunAt.toISOString(),
    lastStatus: routine.lastStatus,
    approvedHosts: [...routine.approvedHosts],
    scope: routine.scope,
  };
}

function toDetailWire(
  routine: {
    id: string;
    title: string;
    schedule: unknown;
    status: 'active' | 'paused' | 'needs_approval';
    pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
    nextRunAt: Date;
    lastRunAt: Date | null;
    lastStatus: 'ok' | 'error' | 'skipped' | null;
    approvedHosts: string[];
    groupId: string | null;
  },
  toolName: string,
) {
  return {
    id: routine.id,
    title: routine.title,
    toolName,
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt.toISOString(),
    lastRunAt: routine.lastRunAt === null ? null : routine.lastRunAt.toISOString(),
    lastStatus: routine.lastStatus,
    approvedHosts: [...routine.approvedHosts],
    scope: routine.groupId === null ? ('personal' as const) : ('group' as const),
  };
}

interface RoutineAccess {
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null };
  manager: boolean;
}

// Reader = the AI's owner, or anyone who can see the topic. Manager =
// the AI's owner, or a group owner/admin who can see the topic. Null for
// a missing/deleted routine, a blind viewer, or a stranger (same shape
// for all, so existence is never leaked).
async function routineAccess(
  db: ServerDatabase,
  routineId: string,
  userId: string,
): Promise<RoutineAccess | null> {
  const found = await getRoutine(db, routineId);
  if (!found) {
    return null;
  }
  return accessFor(db, found.routine, userId);
}

// Same manager check on the raw row, including soft-deleted ones. Only
// the DELETE route uses this (idempotent 204).
async function routineAccessIncludingDeleted(
  db: ServerDatabase,
  routineId: string,
  userId: string,
): Promise<RoutineAccess | null> {
  const row = await findRoutineById(db, routineId);
  if (!row) {
    return null;
  }
  if (row.deletedAt !== null) {
    // A deleted routine reads as missing everywhere except the manager
    // check: resolve the manager on the row so a re-delete answers 204.
    return deletedAccessFor(db, row, userId);
  }
  return accessFor(db, row, userId);
}

async function accessFor(
  db: ServerDatabase,
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null },
  userId: string,
): Promise<RoutineAccess | null> {
  const ai = await findAiOwner(db, routine.aiId);
  if (!ai) {
    return null;
  }
  if (routine.topicId === null) {
    // Personal-chat routine: the AI owner only.
    return ai.owner === userId ? { routine, manager: true } : null;
  }
  const topic = await findTopicById(db, routine.topicId);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  if (ai.owner === userId) {
    return { routine, manager: true };
  }
  const membership = await findMembership(db, routine.groupId as string, userId);
  if (!membership) {
    return null;
  }
  return { routine, manager: membership.role === 'owner' || membership.role === 'admin' };
}

async function deletedAccessFor(
  db: ServerDatabase,
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null },
  userId: string,
): Promise<RoutineAccess | null> {
  // A deleted row's topic may itself be gone; fall back to the group
  // membership alone so the manager check still resolves.
  const ai = await findAiOwner(db, routine.aiId);
  if (!ai) {
    return null;
  }
  if (ai.owner === userId) {
    return { routine, manager: true };
  }
  if (routine.groupId === null) {
    return null;
  }
  if (routine.topicId !== null) {
    const topic = await findTopicById(db, routine.topicId);
    if (topic && !(await canSeeTopic(db, topic, userId))) {
      return null;
    }
  }
  const membership = await findMembership(db, routine.groupId, userId);
  if (!membership) {
    return null;
  }
  return { routine, manager: membership.role === 'owner' || membership.role === 'admin' };
}

// The module's own reads on `effect/sql`. `SELECT *` returns camelCased
// columns (see `../effect/sql`), so the rows keep the drizzle `TopicRow` and
// `RoutineRow` shapes the access helpers and wire mappers already expect.
async function findTopicById(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function listTopicsByGroup(db: ServerDatabase, groupId: string): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  return [...rows];
}

async function findRoutineById(db: ServerDatabase, routineId: string): Promise<RoutineRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${routineId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function findAiOwner(db: ServerDatabase, aiId: string): Promise<{ owner: string } | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function findOwnedAiRow(db: ServerDatabase, aiId: string, ownerId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais
        WHERE id = ${aiId} AND owner = ${ownerId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function findMembership(db: ServerDatabase, groupId: string, userId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: 'owner' | 'admin' | 'member' }>`SELECT role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

function mapServiceError(error: unknown): unknown {
  if (error instanceof RoutineServiceError) {
    if (error.errorCode === 'not_found') {
      return new HttpError(404, 'not_found', 'Routine not found');
    }
    if (error.errorCode === 'needs_approval') {
      return new HttpError(409, 'needs_approval', error.message);
    }
    if (error.errorCode === 'routine_limit' || error.errorCode === 'hosts_not_approved') {
      return new HttpError(400, error.errorCode, error.message);
    }
    return new HttpError(400, 'invalid_request', error.message);
  }
  return error;
}

// Service rejections travel as defects (`Effect.promise`), which `try/catch`
// inside `Effect.gen` cannot see: map them with `catchDefect` and re-die so
// the envelope renders the mapped answer. Unknown rejections pass through
// unchanged and stay a 500, exactly like the old route's unmapped throw.
function withServiceErrors<A>(promise: () => Promise<A>): Effect.Effect<A> {
  return Effect.promise(promise).pipe(
    Effect.catchDefect((defect) => Effect.die(mapServiceError(defect))),
  );
}
