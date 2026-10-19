import type { ServerCore } from '../app/deps';

import { HttpApi, HttpApiBuilder } from 'effect/http-api';

import {
  GroupsCreateRateLimit,
  GroupsGroup,
  GroupsJoinRateLimit,
  GroupsRoleRateLimit,
} from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/recorder';

import { HttpError } from '../errors';
import { mountGroups, handler, type EffectApiMount } from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { limiter, type RateLimiter } from '../rate-limit';
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
import { transferGroupOwner } from './ownership';
import { deleteGroup } from './delete-group';

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
