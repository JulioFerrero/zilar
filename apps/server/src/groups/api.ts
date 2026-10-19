import type { ServerCore } from '../app/deps';

import { Effect } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { SqlClient } from 'effect/sql';

import {
  GroupsCreateRateLimit,
  GroupsGroup,
  GroupsJoinRateLimit,
  GroupsRoleRateLimit,
} from '@zilar/api-contract';
import { recordAudit, type AuditRecorder } from '../audit/recorder';

import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { runSql } from '../effect/sql';
import { mountGroups, handler, type EffectApiMount } from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { limiter, type RateLimiter } from '../rate-limit';
import { roomAffiliationFor } from '../topics/room-members';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { RoomAffiliation } from '../xmpp/admin/schemas';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { syncGroupTopicRooms } from './ais';
import { syncChannelVoice } from './member-roles';
import { destroyQuietly, requireGroup } from './queries';
import type { GroupRole, InviteLogger } from './schemas';
import {
  addGroupAi,
  addGroupMembers,
  changeMemberRole,
  createGroup,
  getGroupDetail,
  getMembership,
  listMembersForViewer,
  patchGroup,
  removeGroupAi,
  removeGroupMember,
  type GroupDetail,
} from './service';
import { setGroupVisibility } from './visibility';
import { joinPublicGroup } from './join';

// Open joins of public groups: 30 per hour per user, so handles cannot be
// farmed; directory and by-handle reads share the same clock.

// Role changes hit ejabberd (one affiliation write per call), so they are
// capped per owner; open joins share the shape. Both budgets run before the
// payload is decoded.
const GroupsApi = HttpApi.make('groups').add(GroupsGroup);

export interface GroupsApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'adminClient' | 'logger'
> {
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  roleLimiter?: RateLimiter;
  joinLimiter?: RateLimiter;
  createLimiter?: RateLimiter;
}

export function createGroupsApi(deps: GroupsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const domain = deps.config.xmpp.domain;
  const listenerAvailable = deps.config.LISTENER_ENABLED;
  const withListenerAvailability = (group: GroupDetail): GroupDetail => ({
    ...group,
    listener: { ...group.listener, available: listenerAvailable },
  });
  const now = deps.now ?? Date.now;
  const roleLimiter = deps.roleLimiter ?? limiter('roleChange', now);
  const joinLimiter = deps.joinLimiter ?? limiter('publicJoin', now);
  const groupCreateLimiter = deps.createLimiter ?? limiter('groupCreate', now);

  function auditVisibilityChange(groupId: string, actorId: string, visibility: string): void {
    if (deps.audit === undefined) {
      return;
    }
    const recorder = deps.audit;
    void recorder
      .record({
        actorUserId: actorId,
        aiId: null,
        groupId,
        action: 'group.visibility_changed',
        subjectId: groupId,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: { groupId, visibility },
      })
      .catch(() => {
        logger.warn({ groupId }, 'could not audit a visibility change');
      });
  }

  const groupLayer = HttpApiBuilder.group(GroupsApi, 'groups', (handlers) =>
    handlers
      .handle(
        'create',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await createGroup(deps.db, deps.adminClient, {
              creatorId: user.id,
              title: request.payload.title,
              memberIds: [...(request.payload.memberIds ?? [])],
              domain,
              logger,
              ...(request.payload.kind === undefined ? {} : { kind: request.payload.kind }),
              ...(request.payload.description === undefined
                ? {}
                : { description: request.payload.description }),
              ...(request.payload.visibility === undefined
                ? {}
                : { visibility: request.payload.visibility }),
              ...(request.payload.handle === undefined ? {} : { handle: request.payload.handle }),
            }),
          ),
        ),
      )
      .handle(
        'detail',
        handler(logger, async (request, user) => {
          const groupId = request.params.id;
          const group = await getGroupDetail(deps.db, groupId, listenerAvailable);
          const membership = group ? await getMembership(deps.db, groupId, user.id) : null;
          if (!group || !membership) {
            throw new HttpError(404, 'not_found', 'Group not found');
          }
          if (group.kind === 'channel' && membership.role === 'member') {
            return { ...group, members: [] };
          }
          return group;
        }),
      )
      .handle(
        'members',
        handler(logger, async (request, user) => {
          const groupId = request.params.id;
          const group = await getGroupDetail(deps.db, groupId);
          if (!group) {
            throw new HttpError(404, 'not_found', 'Group not found');
          }
          const { members } = await listMembersForViewer(deps.db, groupId, user.id);
          return { members };
        }),
      )
      .handle(
        'changeRole',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await changeMemberRole(deps.db, deps.adminClient, {
              groupId: request.params.id,
              actorId: user.id,
              targetUserId: request.params.userId,
              role: request.payload.role,
              domain,
              logger,
              ...(deps.audit === undefined ? {} : { audit: deps.audit }),
            }),
          ),
        ),
      )
      .handle(
        'transferOwner',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await transferGroupOwner(deps.db, deps.adminClient, {
              groupId: request.params.id,
              actorId: user.id,
              targetUserId: request.payload.userId,
              domain,
              logger,
              ...(deps.audit === undefined ? {} : { audit: deps.audit }),
            }),
          ),
        ),
      )
      .handle(
        'deleteGroup',
        handler(logger, async (request, user) => {
          await deleteGroup(deps.db, deps.adminClient, {
            groupId: request.params.id,
            actorId: user.id,
            mucDomain: deps.config.xmpp.mucDomain,
            logger,
            ...(deps.audit === undefined ? {} : { audit: deps.audit }),
          });
        }),
      )
      // Adds members (owner/admin only).
      .handle(
        'addMembers',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await addGroupMembers(deps.db, deps.adminClient, {
              groupId: request.params.id,
              actorId: user.id,
              userIds: [...request.payload.userIds],
              domain,
              logger,
            }),
          ),
        ),
      )
      // Removes a member (owner/admin only).
      .handle(
        'removeMember',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await removeGroupMember(deps.db, deps.adminClient, {
              groupId: request.params.id,
              actorId: user.id,
              targetUserId: request.params.userId,
              domain,
              logger,
            }),
          ),
        ),
      )
      // Adds a group AI (owner/admin only).
      .handle(
        'addAi',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await addGroupAi(deps.db, deps.adminClient, {
              groupId: request.params.id,
              actorId: user.id,
              aiId: request.payload.aiId,
              domain,
              logger,
            }),
          ),
        ),
      )
      // Removes a group AI (owner/admin only).
      .handle(
        'removeAi',
        handler(logger, async (request, user) =>
          withListenerAvailability(
            await removeGroupAi(deps.db, deps.adminClient, {
              groupId: request.params.id,
              actorId: user.id,
              aiId: request.params.aiId,
              domain,
              logger,
            }),
          ),
        ),
      )
      .handle(
        'patch',
        handler(logger, async (request, user) => {
          const groupId = request.params.id;
          const { visibility, handle } = request.payload;
          const wantsVisibility = visibility !== undefined || handle !== undefined;
          if (wantsVisibility) {
            if (visibility === undefined) {
              throw new HttpError(400, 'invalid_request', 'visibility is required with a handle');
            }
            const changed = await setGroupVisibility(deps.db, {
              groupId,
              actorId: user.id,
              visibility,
              ...(handle === undefined ? {} : { handle }),
            });
            auditVisibilityChange(groupId, user.id, changed.visibility);
          }
          const group = await patchGroup(deps.db, {
            groupId,
            actorId: user.id,
            membersCanCreateTopics: request.payload.membersCanCreateTopics,
            ...(request.payload.background === undefined
              ? {}
              : { background: request.payload.background }),
            ...(request.payload.listenerEnabled === undefined
              ? {}
              : { listenerEnabled: request.payload.listenerEnabled }),
            ...(request.payload.listenerEagerness === undefined
              ? {}
              : { listenerEagerness: request.payload.listenerEagerness }),
          });
          return withListenerAvailability(group);
        }),
      )
      .handle(
        'join',
        handler(logger, (request, user) =>
          joinPublicGroup(
            {
              db: deps.db,
              adminClient: deps.adminClient,
              domain,
              logger,
              ...(deps.audit === undefined ? {} : { audit: deps.audit }),
            },
            request.params.id,
            user.id,
          ),
        ),
      ),
  );

  return mountGroups(GroupsApi, groupLayer, {
    auth: deps.auth,
    logger,
    extra: [
      rateLimitLayer(GroupsRoleRateLimit, roleLimiter, 'Too many role changes, try again later'),
      rateLimitLayer(GroupsJoinRateLimit, joinLimiter, 'Too many join attempts, try again later'),
      rateLimitLayer(
        GroupsCreateRateLimit,
        groupCreateLimiter,
        'Too many group creations, try again later',
      ),
    ],
    schemaErrors: true,
  });
}
// Hand a group or channel to another member: the roles swap in one
// transaction (target `owner`, actor `admin`), then the rooms re-sync. The
// old owner can then leave like any admin.
interface TransferGroupOwnerInput {
  groupId: string;
  actorId: string;
  targetUserId: string;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

// Only the owner may transfer (403); the target must be a member (404);
// transferring to themselves is 400. Both rows are written under a per-group
// advisory lock, so two transfers cannot leave two owners.
async function transferGroupOwner(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: TransferGroupOwnerInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);

  const targetRole = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-owner:' + input.groupId}))`;
          const [actor] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
            WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
          if (actor?.role !== 'owner') {
            return yield* Effect.fail(
              new HttpError(403, 'forbidden', 'Only the owner can hand the group over'),
            );
          }
          const [target] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
            WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId} LIMIT 1`;
          if (!target) {
            return yield* Effect.fail(
              new HttpError(404, 'not_found', 'That user is not a member of this group'),
            );
          }
          if (input.targetUserId === input.actorId) {
            return yield* Effect.fail(
              new HttpError(400, 'invalid_request', 'You already own this group'),
            );
          }
          yield* sql`UPDATE group_members SET role = 'owner'
            WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId}`;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${input.groupId} AND user_id = ${input.actorId}`;
          return target.role;
        }),
      );
    }),
  );

  // The rows are committed; the rooms follow best effort, logged with the
  // group id. `syncChannelVoice` re-applies the channel mapping and
  // `syncGroupTopicRooms` re-syncs every topic, so a failure heals.
  const isChannelFeed = group.kind === 'channel';
  const affiliations: Array<{ userId: string; affiliation: RoomAffiliation }> = [
    {
      userId: input.targetUserId,
      affiliation: roomAffiliationFor('owner', isChannelFeed),
    },
    {
      userId: input.actorId,
      affiliation: roomAffiliationFor('admin', isChannelFeed),
    },
  ];
  for (const { userId, affiliation } of affiliations) {
    try {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(userId), input.domain),
        affiliation,
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not set a transfer affiliation');
    }
  }
  await syncChannelVoice(db, adminClient, input.groupId, input.domain, input.logger);
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);

  // Audited as `group.role_changed` (ids and roles only, never names); a failed
  // audit write never fails the request.
  if (input.audit) {
    const changes: Array<{ userId: string; from: GroupRole; to: 'owner' | 'admin' }> = [
      { userId: input.targetUserId, from: targetRole, to: 'owner' },
      { userId: input.actorId, from: 'owner', to: 'admin' },
    ];
    for (const change of changes) {
      try {
        await recordAudit(
          db,
          {
            actorUserId: input.actorId,
            aiId: null,
            groupId: input.groupId,
            action: 'group.role_changed',
            subjectId: change.userId,
            argsHash: null,
            costCurrency: null,
            costAmount: null,
            result: 'ok',
            detail: {
              groupId: input.groupId,
              subjectUserId: change.userId,
              from: change.from,
              to: change.to,
            },
          },
          new Date(),
        );
      } catch {
        input.logger.warn({ groupId: input.groupId }, 'could not audit a role change');
      }
    }
  }

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while handing it over');
  }
  return detail;
}
// The owner deletes a group: every room is destroyed outside the
// transaction, then the group row (children cascade) and the per-chat rows
// keyed by the room JIDs. Only the owner; anyone else answers 403, an
// unknown or invisible group the same 404.
interface DeleteGroupInput {
  groupId: string;
  actorId: string;
  /** The MUC domain used to build each room JID (`<localpart>@<mucDomain>`). */
  mucDomain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

// The chat JID of a room: `<localpart>@<mucDomain>`, lowercased.
function roomJidFor(roomLocalpart: string, mucDomain: string): string {
  return `${roomLocalpart}@${mucDomain}`.toLowerCase();
}

// The owner destroys the group: rows first (one transaction, owner check
// under a per-group advisory lock), then best-effort room destruction, then
// the chat rows that carry no foreign key.
async function deleteGroup(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: DeleteGroupInput,
): Promise<void> {
  await requireGroup(db, input.groupId);

  // Read every room before the cascade removes the topic rows; General is a
  // topic row too, so this is all rooms.
  const rooms = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics
        WHERE group_id = ${input.groupId}`;
    }),
  );

  // One transaction: the owner check and the delete. The cascade removes
  // `group_members`, `topics`, `group_ais`, `group_invite_links`, `handles`,
  // roles, routines, approvals and every other table that references the
  // group.
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-delete:' + input.groupId}))`;
          const [actor] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
            WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
          if (actor === undefined) {
            return yield* Effect.fail(new HttpError(404, 'not_found', 'Group not found'));
          }
          if (actor.role !== 'owner') {
            return yield* Effect.fail(
              new HttpError(403, 'forbidden', 'Only the owner can delete the group'),
            );
          }
          yield* sql`DELETE FROM groups WHERE id = ${input.groupId}`;
        }),
      );
    }),
  );

  const roomJids: string[] = [];
  for (const room of rooms) {
    if (room.roomLocalpart === '') continue;
    roomJids.push(roomJidFor(room.roomLocalpart, input.mucDomain));
    await destroyQuietly(adminClient, room.roomLocalpart);
  }

  // The per-chat rows carry no foreign key to the group or the room, so they
  // are deleted by their JIDs (never by a user id alone) after the commit.
  if (roomJids.length > 0) {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM chat_prefs WHERE chat_jid IN ${sql.in(roomJids)}`;
        yield* sql`DELETE FROM chat_reads WHERE chat_jid IN ${sql.in(roomJids)}`;
        yield* sql`DELETE FROM chat_deliveries WHERE chat_jid IN ${sql.in(roomJids)}`;
      }),
    );
  }

  // Audited with ids only: the group id and the number of rooms that went
  // away; a failed audit write never fails the request.
  if (input.audit) {
    try {
      await recordAudit(
        db,
        {
          actorUserId: input.actorId,
          aiId: null,
          groupId: input.groupId,
          action: 'group.deleted',
          subjectId: input.groupId,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: { groupId: input.groupId, roomCount: rooms.length },
        },
        new Date(),
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not audit a group deletion');
    }
  }
}
