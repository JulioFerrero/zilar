import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import {
  TopicsCreateRateLimit,
  TopicsGroup,
  TopicsJoinRateLimit,
  TopicsPreviewRateLimit,
  type TopicPreviewMessage,
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
  type TopicAiView,
} from './access';
import { withTopicActivity } from './ai-activity';
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
import { senderNamesByJid } from '../xmpp/archive-sender';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { aiAvatarUrls, withAiAvatars } from './views';
import { isAiJid } from '@zilar/protocol';
import { bareJid } from '../jid';
import { decodeAgentPayload, isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';
import { loadEditsForTargets } from '../search/edit-overlay';
import { correctionTarget, retractTarget, timestampToIso } from '../search/snippet';

// effect-plain: the preview is a Promise over the read-only ArchivePool; the Effect layer is topics/api.ts.
// The read-only preview of a public topic a group member has not joined.
// Topic rooms are members-only and their history lives in the MUC archive,
// so the server reads it like message search: one newest-first page, then
// the shared edit overlay.

/** How many messages the preview returns. */
export const TOPIC_PREVIEW_LIMIT = 30;
// Scan more than the page needs, so correction and retraction rows do not
// starve it.
const TOPIC_PREVIEW_SCAN_LIMIT = 120;

const MESSAGE_COLUMNS = `nick, bare_peer AS "barePeer", origin_id AS "originId", timestamp, xml, txt AS "body"`;

// Every value travels as a `$n` binding, never string-built SQL; `roomJid`
// is the room's bare JID, the `username` of its archive rows.
function buildRowsQuery(roomJid: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT ${MESSAGE_COLUMNS} FROM archive
      WHERE username = $1 AND kind = 'groupchat'
      ORDER BY timestamp DESC LIMIT $2`,
    values: [roomJid, TOPIC_PREVIEW_SCAN_LIMIT],
  };
}

/** The last `limit` messages of one room, oldest first. Corrections show
 * the newest body, retracted messages and the live AI card are dropped, and
 * a row with no body and no payload is not a message. `id` is the target
 * `origin_id`, so a message keeps one id across edits. */
type RoomNameLookup = (jids: readonly string[]) => Promise<ReadonlyMap<string, string>>;

const NO_ROOM_NAMES: RoomNameLookup = async () => new Map();

export async function readTopicPreview(
  archive: ArchivePool,
  roomJid: string,
  limit = TOPIC_PREVIEW_LIMIT,
  loadRoomNames: RoomNameLookup = NO_ROOM_NAMES,
): Promise<TopicPreviewMessage[]> {
  const rowsQuery = buildRowsQuery(roomJid);
  const rows = await archive.query(rowsQuery.text, rowsQuery.values);
  const roomNames = await loadRoomNames(rows.map((row) => row.barePeer));

  // Only the original sender's correction or retraction counts.
  const targets = rows.flatMap((row) => {
    const target = correctionTarget(row.xml);
    return target === null || target === row.originId ? [row.originId] : [row.originId, target];
  });
  const overlay = await loadEditsForTargets(archive, { kind: 'room', room: roomJid }, targets);

  const liveIds = liveAiUiIds(rows);
  const seen = new Set<string>();
  const messages: TopicPreviewMessage[] = [];
  for (const row of rows) {
    // A retract row is never a message; its `txt` is the stock fallback.
    if (retractTarget(row.xml) !== null) {
      continue;
    }
    const correction = correctionTarget(row.xml);
    const key = correction ?? row.originId;
    const entry = overlay.get(key);
    if (entry?.retracted === true) {
      continue;
    }
    // A correction is the message only when it is the newest accepted one; the
    // row it supersedes is hidden, and another sender has no overlay entry.
    if (correction !== null) {
      if (entry?.latestText === undefined || entry.latestText !== (row.body ?? '')) {
        continue;
      }
    } else if (entry?.latestText !== undefined) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // The live progress card is not a message and neither is an edit of one;
    // `liveIds` is what this batch already read.
    if (isLiveAiUiRow(row.xml, row.barePeer) || isLiveAiUiEdit(row.xml, liveIds)) {
      continue;
    }
    const body = row.body ?? '';
    // Only an AI may draw a card in the preview: a person can post a `blocks` or
    // `progress` payload, and non-members see this without a sender to check.
    const payload = isAiJid(bareJid(row.barePeer)) ? decodeAgentPayload(row.xml) : null;
    if (body === '' && payload === null) {
      continue;
    }
    messages.push({
      id: key,
      at: timestampToIso(row.timestamp),
      // The real sender's database name; the nick only for an old row with no
      // `bare_peer`.
      nick: roomNames.get(bareJid(row.barePeer)) ?? row.nick,
      body,
      ...(payload === null ? {} : { payload }),
    });
    if (messages.length >= limit) {
      break;
    }
  }

  // The rows arrive newest first; the preview reads oldest first.
  return messages.reverse();
}
// General has no `topic_ais` rows: its AIs are the group's `group_ais`, so
// the list reads them here; shape and order match `listTopicAis`.

async function listGeneralAis(db: ServerDatabase, groupId: string): Promise<TopicAiView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string; jid: string }>`SELECT a.id, a.name, a.jid
        FROM group_ais ga
        INNER JOIN ais a ON a.id = ga.ai_id
        WHERE ga.group_id = ${groupId}`;
    }),
  );
  const ais = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return withAiAvatars(
    ais,
    await aiAvatarUrls(
      db,
      ais.map((ai) => ai.id),
    ),
  );
}
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
