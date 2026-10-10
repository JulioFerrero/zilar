// Groups module on the Effect `HttpApi` adapter (T-0536): the same methods,
// paths, statuses, bodies, limiter order and audit calls as the deleted
// router (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its service runs on effect/sql.
//
// The schemas, the group and its middleware tags live in the shared contract
// (`@zilar/api-contract`, T-0892); this file keeps the handlers and layers.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import {
  CurrentUser,
  GroupsGroup,
  GroupsJoinRateLimit,
  GroupsRoleRateLimit,
} from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
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

export const ROLE_CHANGE_RATE_LIMIT_MAX = 30;
export const ROLE_CHANGE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// T-0164: open joins of public groups: 30 per hour per user (like the
// invite-link join budget's per-user half), so handles cannot be farmed at
// speed. Directory + by-handle reads below share the same clock.
export const PUBLIC_JOIN_RATE_LIMIT_MAX = 30;
export const PUBLIC_JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// T-0124: role changes hit ejabberd (one affiliation write per call), so they
// are capped per owner like topic creation is capped per user. The budget runs
// before the payload is decoded, exactly like the old route's
// `roleLimiter.allow` -> decode order.
function roleRateLimitLayer(limiter: RateLimiter): Layer.Layer<GroupsRoleRateLimit> {
  return Layer.succeed(
    GroupsRoleRateLimit,
    GroupsRoleRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many role changes, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

// T-0164: the join budget runs before the path is decoded, exactly like the old
// route's `joinLimiter.allow` -> `joinPublicGroup` order.
function joinRateLimitLayer(limiter: RateLimiter): Layer.Layer<GroupsJoinRateLimit> {
  return Layer.succeed(
    GroupsJoinRateLimit,
    GroupsJoinRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many join attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const GroupsApi = HttpApi.make('groups').add(GroupsGroup);

export interface GroupsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  roleLimiter?: RateLimiter;
  joinLimiter?: RateLimiter;
}

export function createGroupsApi(deps: GroupsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const domain = deps.config.xmpp.domain;
  // T-0474: every group response carries the listener `available` flag from
  // the server config. Service callers that do not know the config keep the
  // default false and the routes stamp the real value here.
  const listenerAvailable = deps.config.LISTENER_ENABLED;
  const withListenerAvailability = (group: GroupDetail): GroupDetail => ({
    ...group,
    listener: { ...group.listener, available: listenerAvailable },
  });
  const now = deps.now ?? Date.now;
  const roleLimiter =
    deps.roleLimiter ??
    createRateLimiter({
      max: ROLE_CHANGE_RATE_LIMIT_MAX,
      windowMs: ROLE_CHANGE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const joinLimiter =
    deps.joinLimiter ??
    createRateLimiter({
      max: PUBLIC_JOIN_RATE_LIMIT_MAX,
      windowMs: PUBLIC_JOIN_RATE_LIMIT_WINDOW_MS,
      now,
    });

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
      // Creates a group or channel, 201 with the stamped detail.
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
      // The group detail. A non-member sees the same 404 as a missing group,
      // so group ids cannot be probed. A channel subscriber sees the detail
      // without the audience list.
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
      // The channel audience list (admins only); a stranger sees the same 404
      // as a missing group.
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
      // Promotes or demotes a member (owner only, channels only). The limiter
      // middleware already charged the budget, before the payload decode.
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
      // Toggles member topic creation and the other group settings. The
      // visibility + handle branch runs first, one transaction, audited as
      // `group.visibility_changed` (ids only) once it commits.
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
      // Open join for public groups and channels. The join budget was already
      // charged, before the path decode.
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

  const apiLayer = HttpApiBuilder.layer(GroupsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(roleRateLimitLayer(roleLimiter)),
    Layer.provide(joinRateLimitLayer(joinLimiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(GroupsApi, apiLayer);
}
