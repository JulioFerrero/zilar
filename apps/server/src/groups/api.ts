// Groups module on the Effect `HttpApi` adapter (T-0536): the same methods,
// paths, statuses, bodies, limiter order and audit calls as the deleted Hono
// router (`routes.ts`), mounted under Hono by `apps/server/src/effect/http.ts`.
// Handlers keep calling the drizzle service; the DB rewrite is a separate lane.

import { Effect, Layer, Schema } from 'effect';
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
import { CHAT_BACKGROUND_PRESET_IDS } from '../chat-prefs/service';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
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
  MAX_GROUP_MEMBERS,
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

const GroupMemberRole = Schema.Literals(['owner', 'admin', 'member']);
const ChangeableRole = Schema.Literals(['admin', 'member']);
const ChannelKind = Schema.Literals(['group', 'channel']);
const GroupVisibility = Schema.Literals(['private', 'public']);
const ListenerEagerness = Schema.Literals(['quiet', 'normal', 'eager']);
const BackgroundPreset = Schema.Literals(CHAT_BACKGROUND_PRESET_IDS);

// Replaces `titleSchema` / `descriptionSchema` (zod): trimmed before the
// length checks, exactly like the old `.trim().min()/.max()`.
const Title = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const Description = Schema.Trim.check(Schema.isMaxLength(300));
const Handle = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

const MemberIds = Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
  Schema.isMaxLength(MAX_GROUP_MEMBERS),
);

// Replaces `createGroupSchema` (zod). `memberIds` defaults to an empty list;
// `kind`, `description`, `visibility` and `handle` are optional.
const CreateGroupBody = Schema.Struct({
  title: Title,
  memberIds: MemberIds.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  kind: Schema.optional(ChannelKind),
  description: Schema.optional(Description),
  visibility: Schema.optional(GroupVisibility),
  handle: Schema.optional(Handle),
});

// Replaces `addMembersSchema` (zod): 1..50 non-empty user ids.
const AddMembersBody = Schema.Struct({
  userIds: MemberIds.check(Schema.isMinLength(1)),
});

// Replaces `addAiSchema` (zod): one non-empty AI id.
const AddAiBody = Schema.Struct({
  aiId: Schema.String.check(Schema.isMinLength(1)),
});

// Replaces `changeRoleSchema` (zod): strict, `admin` or `member`.
const ChangeRoleBody = Schema.Struct({ role: ChangeableRole });

// Replaces `patchGroupSchema` (zod): strict at the top level and on the
// nested `background` object. `undefined` keeps a field, `null` clears it.
const GroupBackgroundPatch = Schema.Struct({
  backgroundPreset: Schema.optional(Schema.NullOr(BackgroundPreset)),
  backgroundImageId: Schema.optional(Schema.NullOr(Handle)),
  backgroundDim: Schema.optional(
    Schema.NullOr(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(80),
      ),
    ),
  ),
});

const PatchGroupBody = Schema.Struct({
  membersCanCreateTopics: Schema.optional(Schema.Boolean),
  visibility: Schema.optional(GroupVisibility),
  handle: Schema.optional(Handle),
  background: Schema.optional(GroupBackgroundPatch),
  listenerEnabled: Schema.optional(Schema.Boolean),
  listenerEagerness: Schema.optional(ListenerEagerness),
});

const GroupMember = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  role: GroupMemberRole,
  roles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
});

const GroupAi = Schema.Struct({
  aiId: Schema.String,
  jid: Schema.String,
  name: Schema.String,
  ownerId: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
});

const GroupBackground = Schema.Struct({
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
});

const GroupDetailView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.Date,
  membersCanCreateTopics: Schema.Boolean,
  kind: ChannelKind,
  description: Schema.NullOr(Schema.String),
  visibility: GroupVisibility,
  handle: Schema.NullOr(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  background: GroupBackground,
  listener: Schema.Struct({
    enabled: Schema.Boolean,
    eagerness: ListenerEagerness,
    available: Schema.Boolean,
  }),
  members: Schema.Array(GroupMember),
  ais: Schema.Array(GroupAi),
});

const MembersList = Schema.Struct({ members: Schema.Array(GroupMember) });

const JoinResult = Schema.Struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

const GroupIdParams = Schema.Struct({ id: Schema.String });
const GroupMemberParams = Schema.Struct({ id: Schema.String, userId: Schema.String });
const GroupAiParams = Schema.Struct({ id: Schema.String, aiId: Schema.String });

// Applied to the group so a payload decode failure renders like the old zod
// path: a 400 `invalid_request` carrying the first schema message.
class GroupsSchemaErrors extends HttpApiMiddleware.Service<GroupsSchemaErrors>()(
  'zilar/effect/http/GroupsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<GroupsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(GroupsSchemaErrors, (error) =>
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

// T-0124: role changes hit ejabberd (one affiliation write per call), so they
// are capped per owner like topic creation is capped per user. The budget runs
// before the payload is decoded, exactly like the old route's
// `roleLimiter.allow` -> decode order. `requires: CurrentUser` is satisfied by
// `Session`.
class GroupsRoleRateLimit extends HttpApiMiddleware.Service<
  GroupsRoleRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsRoleRateLimit') {}

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
class GroupsJoinRateLimit extends HttpApiMiddleware.Service<
  GroupsJoinRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsJoinRateLimit') {}

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

const GroupsGroup = HttpApiGroup.make('groups')
  .add(
    HttpApiEndpoint.post('create', '/groups', {
      payload: CreateGroupBody,
      success: GroupDetailView,
    }),
    HttpApiEndpoint.get('detail', '/groups/:id', {
      params: GroupIdParams,
      success: GroupDetailView,
    }),
    HttpApiEndpoint.get('members', '/groups/:id/members', {
      params: GroupIdParams,
      success: MembersList,
    }),
    HttpApiEndpoint.put('changeRole', '/groups/:id/members/:userId/role', {
      params: GroupMemberParams,
      payload: ChangeRoleBody,
      success: GroupDetailView,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(GroupsRoleRateLimit),
    HttpApiEndpoint.post('addMembers', '/groups/:id/members', {
      params: GroupIdParams,
      payload: AddMembersBody,
      success: GroupDetailView,
    }),
    HttpApiEndpoint.delete('removeMember', '/groups/:id/members/:userId', {
      params: GroupMemberParams,
      success: GroupDetailView,
    }),
    HttpApiEndpoint.post('addAi', '/groups/:id/ais', {
      params: GroupIdParams,
      payload: AddAiBody,
      success: GroupDetailView,
    }),
    HttpApiEndpoint.delete('removeAi', '/groups/:id/ais/:aiId', {
      params: GroupAiParams,
      success: GroupDetailView,
    }),
    HttpApiEndpoint.patch('patch', '/groups/:id', {
      params: GroupIdParams,
      payload: PatchGroupBody,
      success: GroupDetailView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.post('join', '/groups/:id/join', {
      params: GroupIdParams,
      success: JoinResult,
    }).middleware(GroupsJoinRateLimit),
  )
  .middleware(Session)
  .middleware(GroupsSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

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

export const GROUPS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'POST', path: '/api/groups' },
  { method: 'GET', path: '/api/groups/:id' },
  { method: 'GET', path: '/api/groups/:id/members' },
  { method: 'PUT', path: '/api/groups/:id/members/:userId/role' },
  { method: 'POST', path: '/api/groups/:id/members' },
  { method: 'DELETE', path: '/api/groups/:id/members/:userId' },
  { method: 'POST', path: '/api/groups/:id/ais' },
  { method: 'DELETE', path: '/api/groups/:id/ais/:aiId' },
  { method: 'PATCH', path: '/api/groups/:id' },
  { method: 'POST', path: '/api/groups/:id/join' },
];

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
      .handle('create', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const group = yield* Effect.promise(() =>
              createGroup(deps.db, deps.adminClient, {
                creatorId: user.id,
                title: request.payload.title,
                memberIds: [...request.payload.memberIds],
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
            );
            return HttpServerResponse.jsonUnsafe(withListenerAvailability(group), { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      // The group detail. A non-member sees the same 404 as a missing group,
      // so group ids cannot be probed. A channel subscriber sees the detail
      // without the audience list.
      .handle('detail', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const groupId = request.params.id;
            const group = yield* Effect.promise(() =>
              getGroupDetail(deps.db, groupId, listenerAvailable),
            );
            const membership = group
              ? yield* Effect.promise(() => getMembership(deps.db, groupId, user.id))
              : null;
            if (!group || !membership) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            if (group.kind === 'channel' && membership.role === 'member') {
              return { ...group, members: [] };
            }
            return group;
          }),
          logger,
          requestId,
        );
      })
      // The channel audience list (admins only); a stranger sees the same 404
      // as a missing group.
      .handle('members', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const groupId = request.params.id;
            const group = yield* Effect.promise(() => getGroupDetail(deps.db, groupId));
            if (!group) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            const { members } = yield* Effect.promise(() =>
              listMembersForViewer(deps.db, groupId, user.id),
            );
            return { members };
          }),
          logger,
          requestId,
        );
      })
      // Promotes or demotes a member (owner only, channels only). The limiter
      // middleware already charged the budget, before the payload decode.
      .handle('changeRole', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const group = yield* Effect.promise(() =>
              changeMemberRole(deps.db, deps.adminClient, {
                groupId: request.params.id,
                actorId: user.id,
                targetUserId: request.params.userId,
                role: request.payload.role,
                domain,
                logger,
                ...(deps.audit === undefined ? {} : { audit: deps.audit }),
              }),
            );
            return withListenerAvailability(group);
          }),
          logger,
          requestId,
        );
      })
      // Adds members (owner/admin only).
      .handle('addMembers', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const group = yield* Effect.promise(() =>
              addGroupMembers(deps.db, deps.adminClient, {
                groupId: request.params.id,
                actorId: user.id,
                userIds: [...request.payload.userIds],
                domain,
                logger,
              }),
            );
            return withListenerAvailability(group);
          }),
          logger,
          requestId,
        );
      })
      // Removes a member (owner/admin only).
      .handle('removeMember', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const group = yield* Effect.promise(() =>
              removeGroupMember(deps.db, deps.adminClient, {
                groupId: request.params.id,
                actorId: user.id,
                targetUserId: request.params.userId,
                domain,
                logger,
              }),
            );
            return withListenerAvailability(group);
          }),
          logger,
          requestId,
        );
      })
      // Adds a group AI (owner/admin only).
      .handle('addAi', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const group = yield* Effect.promise(() =>
              addGroupAi(deps.db, deps.adminClient, {
                groupId: request.params.id,
                actorId: user.id,
                aiId: request.payload.aiId,
                domain,
                logger,
              }),
            );
            return withListenerAvailability(group);
          }),
          logger,
          requestId,
        );
      })
      // Removes a group AI (owner/admin only).
      .handle('removeAi', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const group = yield* Effect.promise(() =>
              removeGroupAi(deps.db, deps.adminClient, {
                groupId: request.params.id,
                actorId: user.id,
                aiId: request.params.aiId,
                domain,
                logger,
              }),
            );
            return withListenerAvailability(group);
          }),
          logger,
          requestId,
        );
      })
      // Toggles member topic creation and the other group settings. The
      // visibility + handle branch runs first, one transaction, audited as
      // `group.visibility_changed` (ids only) once it commits.
      .handle('patch', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const groupId = request.params.id;
            const { visibility, handle } = request.payload;
            const wantsVisibility = visibility !== undefined || handle !== undefined;
            if (wantsVisibility) {
              if (visibility === undefined) {
                throw new HttpError(400, 'invalid_request', 'visibility is required with a handle');
              }
              const changed = yield* Effect.promise(() =>
                setGroupVisibility(deps.db, {
                  groupId,
                  actorId: user.id,
                  visibility,
                  ...(handle === undefined ? {} : { handle }),
                }),
              );
              auditVisibilityChange(groupId, user.id, changed.visibility);
            }
            const group = yield* Effect.promise(() =>
              patchGroup(deps.db, {
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
              }),
            );
            return withListenerAvailability(group);
          }),
          logger,
          requestId,
        );
      })
      // Open join for public groups and channels. The join budget was already
      // charged, before the path decode.
      .handle('join', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
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
            );
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(GroupsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(roleRateLimitLayer(roleLimiter)),
    Layer.provide(joinRateLimitLayer(joinLimiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: GROUPS_API_ROUTES };
}
