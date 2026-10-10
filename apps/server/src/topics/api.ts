// Topics module on the Effect `HttpApi` adapter (T-0539): the same methods,
// paths, statuses (201 on create), bodies, limiter order and audit calls as the
// deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { makeRateLimit } from '../effect/rate-limit-middleware';
import {
  SchemaErrors,
  Session,
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  listTopicAis,
  requireVisibleTopic,
  toMissingTopic,
  toTopicView,
  toTopicViews,
  visibleTopics,
} from './access';
import {
  TOPIC_LINK_LABEL_MAX,
  TOPIC_LINK_URL_MAX,
  TOPIC_NAME_MAX,
  addTopicAi,
  addTopicMember,
  archiveTopic,
  createTopic,
  listTopicMembers,
  patchTopic,
  removeTopicAi,
  removeTopicMember,
  setTopicRoles,
  type TopicServiceDeps,
} from './service';

export const TOPIC_CREATE_RATE_LIMIT_MAX = 30;
export const TOPIC_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      return true;
    }
  }
  return false;
}

const TopicVisibility = Schema.Literals(['public', 'private']);
const TopicKind = Schema.Literals(['chat', 'task', 'bug', 'ui', 'routine']);
const TopicStatus = Schema.Literals(['open', 'in_progress', 'in_review', 'blocked', 'done']);

// Replaces `nameSchema` (zod): trimmed, 1..80 characters, no control characters.
const TopicName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TOPIC_NAME_MAX),
  Schema.makeFilter((value) =>
    hasControlCharacters(value) ? 'name must not contain control characters' : undefined,
  ),
);

// Replaces `glyphSchema` (zod): 1..2 code points, no control characters.
const TopicGlyph = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8),
  Schema.makeFilter((value) => {
    const length = [...value].length;
    return length >= 1 && length <= 2 ? undefined : 'glyph must be 1 or 2 characters';
  }),
  Schema.makeFilter((value) =>
    hasControlCharacters(value) ? 'glyph must not contain control characters' : undefined,
  ),
);

// Replaces `linkUrlSchema` (zod): trimmed https URL, 1..300 characters.
const TopicLinkUrl = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TOPIC_LINK_URL_MAX),
  Schema.makeFilter((value) =>
    value.startsWith('https://') ? undefined : 'linkUrl must be an https URL',
  ),
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return undefined;
    } catch {
      return 'linkUrl must be a valid URL';
    }
  }),
);

// Replaces `linkLabelSchema` (zod): trimmed, 1..40 characters.
const TopicLinkLabel = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TOPIC_LINK_LABEL_MAX),
);

// Replaces `ownerSchema` (zod): `user` or `ai` with a non-empty id.
const TopicOwner = Schema.Struct({
  kind: Schema.Literals(['user', 'ai']),
  id: Schema.String.check(Schema.isMinLength(1)),
});

const MemberIds = Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
  Schema.isMaxLength(50),
);

// Replaces `createTopicBodySchema` (zod). `kind`, `visibility`, `memberIds`,
// `glyph` are optional; `owner`, `linkUrl` and `linkLabel` accept null.
const CreateTopicBody = Schema.Struct({
  name: TopicName,
  kind: Schema.optional(TopicKind),
  visibility: Schema.optional(TopicVisibility),
  memberIds: Schema.optional(MemberIds),
  glyph: Schema.optional(TopicGlyph),
  owner: Schema.optional(Schema.NullOr(TopicOwner)),
  linkUrl: Schema.optional(Schema.NullOr(TopicLinkUrl)),
  linkLabel: Schema.optional(Schema.NullOr(TopicLinkLabel)),
});

// Replaces `patchTopicBodySchema` (zod).
const PatchTopicBody = Schema.Struct({
  name: Schema.optional(TopicName),
  glyph: Schema.optional(TopicGlyph),
  kind: Schema.optional(TopicKind),
  status: Schema.optional(TopicStatus),
  owner: Schema.optional(Schema.NullOr(TopicOwner)),
  linkUrl: Schema.optional(Schema.NullOr(TopicLinkUrl)),
  linkLabel: Schema.optional(Schema.NullOr(TopicLinkLabel)),
  archived: Schema.optional(Schema.Literal(true)),
  visibility: Schema.optional(TopicVisibility),
  memberIds: Schema.optional(MemberIds),
  confirmExposeHistory: Schema.optional(Schema.Boolean),
});

// Replaces the module-local `memberBodySchema` (zod): one non-empty user id.
const MemberBody = Schema.Struct({ userId: Schema.String.check(Schema.isMinLength(1)) });

// Replaces `addTopicAiBodySchema` (zod).
const AddTopicAiBody = Schema.Struct({ aiId: Schema.String.check(Schema.isMinLength(1)) });

// Replaces `setTopicRolesBodySchema` (zod): 0..20 non-empty role ids and a
// nullable non-empty approver role id.
const SetTopicRolesBody = Schema.Struct({
  roleIds: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(20)),
  approverRoleId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
});

const TopicOwnerView = Schema.Struct({
  kind: Schema.Literals(['user', 'ai']),
  id: Schema.String,
  name: Schema.String,
});

const TopicAiView = Schema.Struct({ id: Schema.String, name: Schema.String });

const TopicRoleView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  memberCount: Schema.Number,
});

const TopicView = Schema.Struct({
  id: Schema.String,
  groupId: Schema.String,
  name: Schema.String,
  glyph: Schema.String,
  chatJid: Schema.String,
  visibility: TopicVisibility,
  kind: TopicKind,
  status: TopicStatus,
  owner: Schema.NullOr(TopicOwnerView),
  linkUrl: Schema.NullOr(Schema.String),
  linkLabel: Schema.NullOr(Schema.String),
  isGeneral: Schema.Boolean,
  archived: Schema.Boolean,
  memberCount: Schema.Number,
  ais: Schema.Array(TopicAiView),
  roles: Schema.Array(TopicRoleView),
  approverRole: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
});

const TopicList = Schema.Struct({ topics: Schema.Array(TopicView) });

const MembersList = Schema.Struct({
  members: Schema.Array(Schema.Struct({ userId: Schema.String, name: Schema.String })),
});

const TopicAiList = Schema.Struct({ ais: Schema.Array(TopicAiView) });

const GroupIdParams = Schema.Struct({ id: Schema.String });
const TopicIdParams = Schema.Struct({ id: Schema.String });
const TopicMemberParams = Schema.Struct({ id: Schema.String, userId: Schema.String });
const TopicAiParams = Schema.Struct({ id: Schema.String, aiId: Schema.String });

// T-0108: topic creation hits ejabberd, so it is capped per user. The budget
// runs before the payload is decoded, exactly like the old route's
// `createLimiter.allow` -> decode order.
const TopicsCreateRateLimit = makeRateLimit(
  'zilar/effect/http/TopicsCreateRateLimit',
  'Too many topics, try again later',
);

const TopicsGroup = HttpApiGroup.make('topics')
  .add(
    HttpApiEndpoint.get('list', '/groups/:id/topics', {
      params: GroupIdParams,
      success: TopicList,
    }),
    HttpApiEndpoint.post('create', '/groups/:id/topics', {
      params: GroupIdParams,
      payload: CreateTopicBody,
      // 201, as the route always answered.
      success: TopicView.pipe(HttpApiSchema.status(201)),
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(TopicsCreateRateLimit.Middleware),
    HttpApiEndpoint.get('detail', '/topics/:id', {
      params: TopicIdParams,
      success: TopicView,
    }),
    HttpApiEndpoint.patch('patch', '/topics/:id', {
      params: TopicIdParams,
      payload: PatchTopicBody,
      success: TopicView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.post('archive', '/topics/:id/archive', {
      params: TopicIdParams,
      success: TopicView,
    }),
    HttpApiEndpoint.get('members', '/topics/:id/members', {
      params: TopicIdParams,
      success: MembersList,
    }),
    HttpApiEndpoint.post('addMember', '/topics/:id/members', {
      params: TopicIdParams,
      payload: MemberBody,
      success: TopicView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('removeMember', '/topics/:id/members/:userId', {
      params: TopicMemberParams,
      success: TopicView,
    }),
    HttpApiEndpoint.put('setRoles', '/topics/:id/roles', {
      params: TopicIdParams,
      payload: SetTopicRolesBody,
      success: TopicView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('listAis', '/topics/:id/ais', {
      params: TopicIdParams,
      success: TopicAiList,
    }),
    HttpApiEndpoint.post('addAi', '/topics/:id/ais', {
      params: TopicIdParams,
      payload: AddTopicAiBody,
      success: TopicView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('removeAi', '/topics/:id/ais/:aiId', {
      params: TopicAiParams,
      success: TopicView,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const TopicsApi = HttpApi.make('topics').add(TopicsGroup);

export interface TopicsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

export function createTopicsApi(deps: TopicsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const mucDomain = deps.config.xmpp.mucDomain;
  const createLimiter = createRateLimiter({
    max: TOPIC_CREATE_RATE_LIMIT_MAX,
    windowMs: TOPIC_CREATE_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  function serviceDeps(): TopicServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      domain: deps.config.xmpp.domain,
      logger: deps.logger,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(TopicsApi, 'topics', (handlers) =>
    handlers
      // A stranger (or a missing group) sees an empty list, never a 403/404
      // that would reveal the group exists. The group route itself already
      // answers 404 for non-members; this list only narrows to visible topics.
      .handle(
        'list',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const rows = yield* Effect.promise(() =>
              visibleTopics(deps.db, request.params.id, user.id),
            );
            return { topics: yield* Effect.promise(() => toTopicViews(deps.db, rows, mucDomain)) };
          }),
        ),
      )
      // Creates a topic; the limiter middleware already charged the budget,
      // before the payload decode.
      .handle(
        'create',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const payload = request.payload;
            const topic = yield* Effect.promise(() =>
              createTopic(serviceDeps(), {
                groupId: request.params.id,
                actorId: user.id,
                name: payload.name,
                ...(payload.kind === undefined ? {} : { kind: payload.kind }),
                ...(payload.visibility === undefined ? {} : { visibility: payload.visibility }),
                ...(payload.memberIds === undefined ? {} : { memberIds: [...payload.memberIds] }),
                ...(payload.glyph === undefined ? {} : { glyph: payload.glyph }),
                ...(payload.owner === undefined ? {} : { owner: payload.owner }),
                ...(payload.linkUrl === undefined ? {} : { linkUrl: payload.linkUrl }),
                ...(payload.linkLabel === undefined ? {} : { linkLabel: payload.linkLabel }),
              }),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      .handle(
        'detail',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              requireVisibleTopic(deps.db, request.params.id, user.id),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      .handle(
        'patch',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const payload = request.payload;
            const topic = yield* Effect.promise(() =>
              patchTopic(serviceDeps(), {
                topicId: request.params.id,
                actorId: user.id,
                ...(payload.name === undefined ? {} : { name: payload.name }),
                ...(payload.glyph === undefined ? {} : { glyph: payload.glyph }),
                ...(payload.kind === undefined ? {} : { kind: payload.kind }),
                ...(payload.status === undefined ? {} : { status: payload.status }),
                ...(payload.owner === undefined ? {} : { owner: payload.owner }),
                ...(payload.linkUrl === undefined ? {} : { linkUrl: payload.linkUrl }),
                ...(payload.linkLabel === undefined ? {} : { linkLabel: payload.linkLabel }),
                ...(payload.archived === undefined ? {} : { archived: payload.archived }),
                ...(payload.visibility === undefined ? {} : { visibility: payload.visibility }),
                ...(payload.memberIds === undefined ? {} : { memberIds: [...payload.memberIds] }),
                ...(payload.confirmExposeHistory === undefined
                  ? {}
                  : { confirmExposeHistory: payload.confirmExposeHistory }),
              }),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      .handle(
        'archive',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              archiveTopic(serviceDeps(), request.params.id, user.id),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      .handle(
        'members',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const members = yield* Effect.promise(() =>
              listTopicMembers(serviceDeps(), request.params.id, user.id),
            );
            return { members };
          }),
        ),
      )
      .handle(
        'addMember',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              addTopicMember(serviceDeps(), request.params.id, user.id, request.payload.userId),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      .handle(
        'removeMember',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              removeTopicMember(serviceDeps(), request.params.id, user.id, request.params.userId),
            );
            // Removing the last private member archives the topic: it is no
            // longer visible, so answer like a deletion. The row survives.
            if (topic.archivedAt !== null) {
              throw toMissingTopic();
            }
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      // T-0116: attach roles to a private topic and pick its approver role.
      // The actor must be a topic manager who can see the topic; a stranger
      // gets the same 404 as a missing id.
      .handle(
        'setRoles',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              setTopicRoles(serviceDeps(), {
                topicId: request.params.id,
                actorId: user.id,
                roleIds: [...request.payload.roleIds],
                approverRoleId: request.payload.approverRoleId,
              }),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      // T-0109: AIs in non-General topics.
      .handle(
        'listAis',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              requireVisibleTopic(deps.db, request.params.id, user.id),
            );
            const ais = yield* Effect.promise(() => listTopicAis(deps.db, topic.id));
            return { ais };
          }),
        ),
      )
      .handle(
        'addAi',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              addTopicAi(serviceDeps(), {
                topicId: request.params.id,
                actorId: user.id,
                aiId: request.payload.aiId,
              }),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      .handle(
        'removeAi',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              removeTopicAi(serviceDeps(), request.params.id, user.id, request.params.aiId),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(TopicsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(TopicsCreateRateLimit.layer(createLimiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(TopicsApi, apiLayer);
}
