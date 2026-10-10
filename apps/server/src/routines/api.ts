// Routines module on the Effect `HttpApi` adapter (T-0554): the same
// methods, paths, statuses (204 on delete), bodies, audit calls and step
// order as the old router (`routes.ts`), which has since been deleted along
// with its thin wrapper; mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.

import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { RoutinesGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { canSeeTopic } from '../topics/access';
import { routineAccess, routineAccessIncludingDeleted } from './access';
import { findMembership, findOwnedAiRow, findTopicById, listTopicsByGroup } from './reads';
import {
  deleteRoutine,
  getRoutine,
  listRoutinesForAi,
  listRoutinesForTopic,
  pauseRoutine,
  resumeRoutine,
  type PublicRoutine,
} from './service';
import { withServiceErrors } from './status-errors';
import { toDetailWire, toListWire } from './wire';

const RoutinesApi = HttpApi.make('routines').add(RoutinesGroup);

export interface RoutinesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: Logger;
  audit?: AuditRecorder;
  /** Injected in tests so pause/resume/delete timestamps can advance. */
  now?: () => Date;
}

export function createRoutinesApi(deps: RoutinesApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? (() => new Date());

  const groupLayer = HttpApiBuilder.group(RoutinesApi, 'routines', (handlers) =>
    handlers
      .handle(
        'listForAi',
        handler(logger, async (request, user) => {
          const ai = await findOwnedAiRow(deps.db, request.params.id, user.id);
          if (!ai) {
            throw new HttpError(404, 'not_found', 'AI not found');
          }
          // Only routines of topics the owner can see: a routine in a
          // private topic the owner was removed from stays hidden until
          // they are back.
          const all = await listRoutinesForAi(deps.db, ai.id);
          const visible: PublicRoutine[] = [];
          for (const routine of all) {
            if (routine.topicId === null) {
              visible.push(routine);
              continue;
            }
            const topic = await findTopicById(deps.db, routine.topicId);
            if (topic && (await canSeeTopic(deps.db, topic, user.id))) {
              visible.push(routine);
            }
          }
          return visible.map(toListWire);
        }),
      )
      .handle(
        'listForGroup',
        handler(logger, async (request, user) => {
          const groupId = request.params.id;
          const membership = await findMembership(deps.db, groupId, user.id);
          if (!membership) {
            throw new HttpError(404, 'not_found', 'Group not found');
          }
          // Only routines of topics the viewer can see.
          const topicRows = await listTopicsByGroup(deps.db, groupId);
          const result: PublicRoutine[] = [];
          for (const topic of topicRows) {
            if (topic.archivedAt !== null) {
              continue;
            }
            if (!(await canSeeTopic(deps.db, topic, user.id))) {
              continue;
            }
            const rows = await listRoutinesForTopic(deps.db, topic.id);
            for (const routine of rows) {
              result.push(routine);
            }
          }
          return result.map(toListWire);
        }),
      )
      .handle(
        'pause',
        handler(logger, (request, user) =>
          changeStatus(request.params.id, user.id, (id) =>
            pauseRoutine(deps.db, id, user.id, now(), deps.audit),
          ),
        ),
      )
      .handle(
        'resume',
        handler(logger, (request, user) =>
          changeStatus(request.params.id, user.id, (id) =>
            resumeRoutine(deps.db, id, user.id, now(), deps.audit),
          ),
        ),
      )
      .handle(
        'remove',
        handler(logger, async (request, user) => {
          const routineId = request.params.id;
          // Like the tools delete: managers resolve on the raw row
          // (including soft-deleted ones) so a re-delete answers 204;
          // strangers still get the missing-id 404.
          const access = await routineAccessIncludingDeleted(deps.db, routineId, user.id);
          if (!access || !access.manager) {
            throw new HttpError(404, 'not_found', 'Routine not found');
          }
          await deleteRoutine(deps.db, routineId, user.id, now(), deps.audit);
        }),
      ),
  );

  // Pause and resume share the access check and the re-read; only the service
  // call differs. A service error maps through `mapServiceError`.
  function changeStatus(
    routineId: string,
    userId: string,
    change: (id: string) => Promise<unknown>,
  ) {
    return Effect.gen(function* () {
      const access = yield* Effect.promise(() => routineAccess(deps.db, routineId, userId));
      if (!access || !access.manager) {
        throw new HttpError(404, 'not_found', 'Routine not found');
      }
      yield* withServiceErrors(() => change(access.routine.id));
      const found = yield* Effect.promise(() => getRoutine(deps.db, access.routine.id));
      if (!found) {
        throw new HttpError(404, 'not_found', 'Routine not found');
      }
      return toDetailWire(found.routine, found.toolName);
    });
  }

  const apiLayer = HttpApiBuilder.layer(RoutinesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(RoutinesApi, apiLayer);
}
