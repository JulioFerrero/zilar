import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import {
  TopicsCreateRateLimit,
  TopicsGroup,
  TopicsJoinRateLimit,
  TopicsPreviewRateLimit,
} from '@zilar/api-contract';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { createRateLimiter } from '../rate-limit';
import type { ArchivePool } from '../search/service';
import {
  listTopicAis,
  requireVisibleTopic,
  toMissingTopic,
  toTopicView,
  toTopicViews,
  visibleTopics,
} from './access';
import { withTopicActivity } from './ai-activity';
import { listGeneralAis } from './general-ais';
import {
  addTopicAi,
  addTopicMember,
  archiveTopic,
  createTopic,
  listTopicMembers,
  removeTopicAi,
  removeTopicMember,
  setTopicRoles,
  type TopicServiceDeps,
} from './service';
import { joinTopic } from './members';
import { patchTopic } from './patch';
import { readTopicPreview, TOPIC_PREVIEW_LIMIT } from './preview';
import { senderNamesByJid } from '../xmpp/archive-sender';

export const TOPIC_CREATE_RATE_LIMIT_MAX = 30;
export const TOPIC_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const TOPIC_JOIN_RATE_LIMIT_MAX = 60;
export const TOPIC_JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const TOPIC_PREVIEW_RATE_LIMIT_MAX = 120;
export const TOPIC_PREVIEW_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const TopicsApi = HttpApi.make('topics').add(TopicsGroup);

export interface TopicsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
  /** the MUC archive read for the topic preview; absent → 501. */
  archive?: ArchivePool;
  /** the live gateway's turn read model for each topic's AI activity. */
  getGateway?: () => TurnWatcher | null;
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
  const joinLimiter = createRateLimiter({
    max: TOPIC_JOIN_RATE_LIMIT_MAX,
    windowMs: TOPIC_JOIN_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });
  const previewLimiter = createRateLimiter({
    max: TOPIC_PREVIEW_RATE_LIMIT_MAX,
    windowMs: TOPIC_PREVIEW_RATE_LIMIT_WINDOW_MS,
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
      // A stranger or a missing group sees an empty list, never a 403/404 that
      // would reveal the group exists; the list only narrows to visible topics.
      .handle(
        'list',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const rows = yield* Effect.promise(() =>
              visibleTopics(deps.db, request.params.id, user.id),
            );
            return {
              topics: yield* Effect.promise(async () =>
                withTopicActivity(deps, await toTopicViews(deps.db, rows, mucDomain, user.id)),
              ),
            };
          }),
        ),
      )
      // The limiter middleware already charged the budget before the payload
      // decode.
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
                ...(payload.done === undefined ? {} : { done: payload.done }),
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
        'join',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              joinTopic(serviceDeps(), request.params.id, user.id),
            );
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      // A group member reads a public topic they have not joined, read-only, from
      // the archive, not over XMPP. Private and General topics answer the same 404
      // as a missing id, as does an invisible topic.
      .handle(
        'preview',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              requireVisibleTopic(deps.db, request.params.id, user.id),
            );
            if (topic.isGeneral || topic.visibility === 'private') {
              throw toMissingTopic();
            }
            const archive = deps.archive;
            if (archive === undefined) {
              throw new HttpError(501, 'preview_unavailable', 'Topic preview is not configured');
            }
            const roomJid = `${topic.roomLocalpart}@${mucDomain}`;
            const messages = yield* Effect.tryPromise({
              try: () =>
                readTopicPreview(archive, roomJid, TOPIC_PREVIEW_LIMIT, (jids) =>
                  senderNamesByJid(deps.db, jids),
                ),
              catch: () => {
                logger.error({ topicId: topic.id }, 'topic preview failed');
                return new HttpError(
                  502,
                  'preview_failed',
                  'Topic preview failed, try again later',
                );
              },
            }).pipe(Effect.orDie);
            return { messages };
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
            // Removing the last private member archives the topic; answer like a
            // deletion, though the row survives.
            if (topic.archivedAt !== null) {
              throw toMissingTopic();
            }
            return yield* Effect.promise(() => toTopicView(deps.db, topic, mucDomain));
          }),
        ),
      )
      // Attach roles to a private topic and pick its approver role: the actor
      // must be a topic manager who can see it; a stranger gets the same 404.
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
      // AIs in non-General topics; General lists the group's AIs, since it has no
      // `topic_ais` rows.
      .handle(
        'listAis',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topic = yield* Effect.promise(() =>
              requireVisibleTopic(deps.db, request.params.id, user.id),
            );
            const ais = yield* Effect.promise(() =>
              topic.isGeneral
                ? listGeneralAis(deps.db, topic.groupId)
                : listTopicAis(deps.db, topic.id),
            );
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
    // Topic creation hits ejabberd, so it is capped per user; the budget runs
    // before the payload is decoded.
    Layer.provide(
      rateLimitLayer(TopicsCreateRateLimit, createLimiter, 'Too many topics, try again later'),
    ),
    // Joining a topic syncs the room on ejabberd, so it is capped per user too.
    Layer.provide(
      rateLimitLayer(TopicsJoinRateLimit, joinLimiter, 'Too many joins, try again later'),
    ),
    // reading a topic's archive for a non-member is capped per user.
    Layer.provide(
      rateLimitLayer(TopicsPreviewRateLimit, previewLimiter, 'Too many previews, try again later'),
    ),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(TopicsApi, apiLayer);
}
