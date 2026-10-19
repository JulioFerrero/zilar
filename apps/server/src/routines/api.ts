import type { ServerCore } from '../app/deps';
import { Effect } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { RoutinesGroup } from '@zilar/api-contract';

import { type AuditRecorder } from '../audit/recorder';
import { deleteRoutine, pauseRoutine, resumeRoutine } from './support';
import { getRoutine, listRoutinesForAi, listRoutinesForTopic } from './queries';
import { type PublicRoutine } from './schemas';

import { mountGroups, handler, type EffectApiMount } from '../effect/http-core';
import { HttpError } from '../errors';
import { findGroupMembership } from '../groups/access';
import { canSeeTopic } from '../topics/access';
import { routineAccess, routineAccessIncludingDeleted } from './access';
import {
  findOwnedAiRow,
  findTopicById,
  listMyRoutines,
  listTopicsByGroup,
  listVisibleTopicRoutines,
  type MyRoutineView,
} from './reads';
import { withServiceErrors } from './status-errors';
function toListWire(routine: PublicRoutine) {
  return {
    id: routine.id,
    aiId: routine.aiId,
    groupId: routine.groupId,
    topicId: routine.topicId,
    kind: routine.kind,
    toolId: routine.toolId ?? undefined,
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
    kind: 'tool' | 'prompt';
  },
  toolName: string,
) {
  return {
    id: routine.id,
    kind: routine.kind,
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

const RoutinesApi = HttpApi.make('routines').add(RoutinesGroup);

export interface RoutinesApiDependencies extends Pick<ServerCore, 'auth' | 'db' | 'logger'> {
  audit?: AuditRecorder;
  now?: () => Date;
  // The MUC domain room JIDs are built from; optional so tests can omit it.
  mucDomain?: string;
}

export function createRoutinesApi(deps: RoutinesApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? (() => new Date());

  const groupLayer = HttpApiBuilder.group(RoutinesApi, 'routines', (handlers) =>
    handlers
      .handle(
        'listMine',
        handler(logger, async (_request, user) => {
          // Running first, then by title, the order Settings › Routines groups by.
          const routines = await listMyRoutines(deps.db, user.id, deps.mucDomain);
          routines.sort(
            (a, b) =>
              routineRank(a.routine.status) - routineRank(b.routine.status) ||
              a.routine.title.localeCompare(b.routine.title) ||
              a.routine.id.localeCompare(b.routine.id),
          );
          return routines.map(toMyRoutineWire);
        }),
      )
      .handle(
        'listForAi',
        handler(logger, async (request, user) => {
          const ai = await findOwnedAiRow(deps.db, request.params.id, user.id);
          if (!ai) {
            throw new HttpError(404, 'not_found', 'AI not found');
          }
          // A routine in a private topic the owner was removed from stays hidden until they are back.
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
          const membership = await findGroupMembership(deps.db, groupId, user.id);
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
        'listForTopic',
        handler(logger, async (request, user) => {
          const rows = await listVisibleTopicRoutines(deps.db, request.params.id, user.id);
          if (rows === null) {
            throw new HttpError(404, 'not_found', 'Topic not found');
          }
          return rows.map(toListWire);
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
          // Managers resolve on the raw row so a re-delete answers 204; strangers still get the missing-id 404.
          const access = await routineAccessIncludingDeleted(deps.db, routineId, user.id);
          if (!access || !access.manager) {
            throw new HttpError(404, 'not_found', 'Routine not found');
          }
          await deleteRoutine(deps.db, routineId, user.id, now(), deps.audit);
        }),
      ),
  );

  // Pause and resume share the access check and re-read; only the service call differs.
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

  return mountGroups(RoutinesApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: true,
  });
}

// Running routines sort ahead of paused and needs-approval ones.
function routineRank(status: PublicRoutine['status']): number {
  return status === 'active' ? 0 : 1;
}

function toMyRoutineWire(view: MyRoutineView) {
  return {
    ...toListWire(view.routine),
    aiName: view.aiName,
    aiAvatarUrl: view.aiAvatarUrl,
    chatName: view.chatName,
    chatJid: view.chatJid,
  };
}
