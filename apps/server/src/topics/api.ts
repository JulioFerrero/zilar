// Topics module on the Effect `HttpApi` adapter (T-0539): the same methods,
// paths, statuses (201 on create), bodies, limiter order and audit calls as the
// deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.
//
// The schemas, the group and its middleware tags live in the shared contract
// (`@zilar/api-contract`, T-0892); this file keeps the handlers and layers.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import { CurrentUser, TopicsCreateRateLimit, TopicsGroup } from '@zilar/api-contract';
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
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { chainASchemaErrorLayer } from '../groups/schema-errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
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

// T-0108: topic creation hits ejabberd, so it is capped per user. The budget
// runs before the payload is decoded, exactly like the old route's
// `createLimiter.allow` -> decode order.
function createRateLimitLayer(limiter: RateLimiter): Layer.Layer<TopicsCreateRateLimit> {
  return Layer.succeed(
    TopicsCreateRateLimit,
    TopicsCreateRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many topics, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

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
    Layer.provide(createRateLimitLayer(createLimiter)),
    Layer.provide(chainASchemaErrorLayer(logger)),
  );

  return mountApi(TopicsApi, apiLayer);
}
