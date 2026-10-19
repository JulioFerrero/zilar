import type { ServerCore } from '../app/deps';

import { Effect } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import { ChatsGroup } from '@zilar/api-contract';
import type { HttpServerRequest } from 'effect/http';

import type { TurnWatcher } from '../agents/gateway/stop-types';
import { listAis } from '../ais/queries';
import type { PublicAi } from '../ais/persona';
import { createAuditRecorder, type AuditRecorder } from '../audit/recorder';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { requireChatAccess } from '../chat-prefs/access';
import { listContacts } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import {
  mountGroups,
  handler,
  type EffectApiMount,
  httpErrorResponse,
  requestIdOf,
  type SessionUser,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { ownBareJid } from '../jid';
import { limiter, type RateLimiter } from '../rate-limit';
import { allowedArchives, type ArchivePool } from '../search/service';
import { type TopicView } from '../topics/access';
import { withTopicActivity } from '../topics/ai-activity';
import { visibleTopicsForGroups } from '../topics/visible-batch';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { replyFor, kindFor } from './reply-handler';
import { buildDisplayed } from '@zilar/xmpp-core';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { deliveredForChats, mergeTopicMarks, type DeliveryLookup } from './deliveries';
import { markDeliveredAndNotify } from './delivered-notice';
import { chatAccessFromParam, putChatRead, readForChats } from './reads';
import { unreadForChats, type ChatUnread, type UnreadScope } from './unread';
import { listGroupsForUser } from '../groups/queries';
import { type GroupBackground, type GroupRole } from '../groups/schemas';
import { toTopicViews } from '../topics/views';

// effect-plain: mark handler bodies, access and limits only
// `api.ts` wraps these with `handler` and the limiter, so access is checked before the write budget.

interface MarkReadRequest {
  params: { jid: string };
  payload: { messageId: string; displayed?: string | undefined };
  request: HttpServerRequest.HttpServerRequest;
}

interface MarkDeliveredRequest {
  params: { jid: string };
  payload: { originIds: readonly string[] };
  request: HttpServerRequest.HttpServerRequest;
}

// Access is checked before the write budget, so a probe costs nothing and answers the same 404.
async function markReadFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: MarkReadRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
  if (!limiter.allow(user.id)) {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(429, 'rate_limited', 'Too many read updates, try again later'),
    );
  }
  await putChatRead(deps.db, {
    bare,
    userId: user.id,
    messageId: request.payload.messageId,
  });

  // Sends the same XEP-0333 marker an in-app read does; best effort, the mark is already stored.
  const displayed = request.payload.displayed;
  const adminClient = deps.adminClient;
  if (displayed !== undefined && adminClient !== undefined) {
    try {
      const callerBare = jidFor(localpartFor(user.id), deps.config.xmpp.domain);
      const stanza = buildDisplayed({
        chatJid: bare,
        kind: kindFor(bare, deps.config.xmpp.mucDomain),
        messageId: displayed,
      }).toString();
      await adminClient.sendStanza(callerBare, bare, stanza);
    } catch {
      deps.logger.warn({ userId: user.id, chatJid: bare }, 'read marker send failed');
    }
  }
}

// Access is checked before the write budget, like the read mark.
async function markDeliveredFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: MarkDeliveredRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
  if (!limiter.allow(user.id)) {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(429, 'rate_limited', 'Too many delivered updates, try again later'),
    );
  }
  // Stores the mark and, for a moved DM, tells the author's devices off the HTTP path.
  await markDeliveredAndNotify(deps, {
    bare,
    userId: user.id,
    originIds: request.payload.originIds,
  });
}

export interface ChatsApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  // Undefined = the list keeps its shape (no unread, no previews).
  archive: ArchivePool | undefined;
  // Optional: with no client the delivered notice is skipped.
  adminClient?: EjabberdAdminClient;
  // The live gateway's turn read model for each topic's AI activity.
  getGateway?: () => TurnWatcher | null;
  now?: () => number;
}

// The contract's schema passes each entry through unchanged, so the wire shape is exactly what the route returned.
const ChatsApi = HttpApi.make('chats').add(ChatsGroup);

export function createChatsApi(deps: ChatsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const readLimiter = limiter('chatRead', now);
  // The notification reply has its own budget, checked before the claim.
  const replyLimiter = limiter('chatReply', now);
  // Both DM delete handlers are built in `delete-own.ts`.
  const deleteOwn = deleteOwnHandlers(deps);

  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) => listChatsFor(deps, user)),
      )
      // Access is checked before the write budget, so a probe of an invisible chat costs nothing and answers the same 404.
      .handle(
        'markRead',
        handler(logger, (request, user) => markReadFor(deps, readLimiter, request, user)),
      )
      // Access is checked before the write budget, like the read mark.
      .handle(
        'markDelivered',
        handler(logger, (request, user) => markDeliveredFor(deps, readLimiter, request, user)),
      )
      // The caller's own copy of a DM.
      .handle('clearHistory', deleteOwn.clearHistory)
      .handle('deleteForMe', deleteOwn.deleteForMe)
      // A reply from a phone notification, sent as the caller.
      .handle(
        'reply',
        handler(logger, (request, user) => replyFor(deps, replyLimiter, request, user)),
      ),
  );

  return mountGroups(ChatsApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: true,
  });
}
// Clear-history and delete-for-me for DMs, scoped to the caller's own archive rows (username = caller localpart, bare_peer = peer).
// Only direct chats: a group or room answers 400.

interface DeleteOwnDependencies extends Pick<ServerCore, 'db'> {
  // Undefined answers 503, like the search route.
  archive: ArchivePool | undefined;
  // Records one id-only entry per delete; a failed audit write never throws.
  audit: AuditRecorder;
}

// Int8 bound, and the id is bound as a string (never a `BigInt`), so an id Postgres could not cast is a 400, not a 500.
const ARCHIVE_ID_PATTERN = /^\d+$/;
const MAX_ARCHIVE_ID = 9223372036854775807n;

function archiveRequired(archive: ArchivePool | undefined): ArchivePool {
  if (archive === undefined) {
    throw xmppUnavailable();
  }
  return archive;
}

// The same access rule as the read mark, so unknown and invisible chats answer the same 404; a group answers 400.
async function requireDmAccess(
  db: ServerDatabase,
  options: { chatJid: string; userId: string; domain: string; mucDomain: string },
): Promise<{ bare: string }> {
  const { bare } = await requireChatAccess(db, options);
  const host = bare.slice(bare.indexOf('@') + 1);
  if (host === options.mucDomain.toLowerCase()) {
    throw new HttpError(400, 'invalid_request', 'Only direct chats');
  }
  return { bare };
}

// Deletes the caller's archive rows with `bare`, then the read and delivery marks, and records one audit entry.
async function clearOwnHistory(
  deps: DeleteOwnDependencies,
  options: { userId: string; bare: string },
): Promise<number> {
  const archive = archiveRequired(deps.archive);
  const username = localpartFor(options.userId);
  const deleted = await archive.query(
    'DELETE FROM archive WHERE username = $1 AND bare_peer = $2 RETURNING timestamp',
    [username, options.bare],
  );
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM chat_reads
        WHERE user_id = ${options.userId} AND chat_jid = ${options.bare}`;
      // The caller's own delivery row held a mark into the author's archive; clearing the copy drops it.
      yield* sql`DELETE FROM chat_deliveries
        WHERE user_id = ${options.userId} AND chat_jid = ${options.bare}`;
    }),
  );
  await deps.audit.record({
    actorUserId: options.userId,
    aiId: null,
    groupId: null,
    action: 'chat.history_cleared',
    subjectId: null,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { chatJid: options.bare, deleted: deleted.length },
  });
  return deleted.length;
}

// Deletes exactly one of the caller's archive rows; the id is validated as digits and bound as a string, never a `BigInt`.
async function deleteOwnArchiveRow(
  deps: DeleteOwnDependencies,
  options: { userId: string; bare: string; archiveId: string },
): Promise<boolean> {
  if (!ARCHIVE_ID_PATTERN.test(options.archiveId)) {
    throw new HttpError(400, 'invalid_request', 'archiveId must be an archive id');
  }
  const parsed = BigInt(options.archiveId);
  if (parsed > MAX_ARCHIVE_ID) {
    throw new HttpError(400, 'invalid_request', 'archiveId must be an archive id');
  }
  const archive = archiveRequired(deps.archive);
  const username = localpartFor(options.userId);
  const deleted = await archive.query(
    'DELETE FROM archive WHERE username = $1 AND bare_peer = $2 AND timestamp = $3 RETURNING timestamp',
    [username, options.bare, options.archiveId],
  );
  if (deleted.length === 0) {
    return false;
  }
  await deps.audit.record({
    actorUserId: options.userId,
    aiId: null,
    groupId: null,
    action: 'chat.message_deleted',
    subjectId: null,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { chatJid: options.bare, deleted: 1 },
  });
  return true;
}

// The two delete handlers live here so `api.ts` only names them.
interface DeleteOwnHandlerDependencies extends Pick<ServerCore, 'db' | 'config' | 'logger'> {
  archive: ArchivePool | undefined;
  now?: () => number;
}

interface ChatJidRequest {
  params: { jid: string };
  request: HttpServerRequest.HttpServerRequest;
}

interface ArchiveIdRequest {
  params: { jid: string; archiveId: string };
  request: HttpServerRequest.HttpServerRequest;
}

// A malformed percent escape is an unknown chat (404), not a server error.
export function decodeChatJid(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
}

function tooManyChanges(): HttpError {
  return new HttpError(429, 'rate_limited', 'Too many history changes, try again later');
}

// Both check DM access before the shared write budget.
function deleteOwnHandlers(deps: DeleteOwnHandlerDependencies) {
  const logger = deps.logger;
  // A failed audit write is logged, never thrown.
  const audit = createAuditRecorder({ db: deps.db, logger });
  const historyLimiter = limiter('chatHistoryWrite', deps.now ?? Date.now);
  const service: DeleteOwnDependencies = { db: deps.db, archive: deps.archive, audit };
  const { domain, mucDomain } = deps.config.xmpp;
  return {
    clearHistory: handler(logger, async (request: ChatJidRequest, user: SessionUser) => {
      const { bare } = await requireDmAccess(deps.db, {
        chatJid: decodeChatJid(request.params.jid),
        userId: user.id,
        domain,
        mucDomain,
      });
      if (!historyLimiter.allow(user.id)) {
        return httpErrorResponse(requestIdOf(request.request), tooManyChanges());
      }
      await clearOwnHistory(service, { userId: user.id, bare });
    }),
    deleteForMe: handler(logger, async (request: ArchiveIdRequest, user: SessionUser) => {
      const { bare } = await requireDmAccess(deps.db, {
        chatJid: decodeChatJid(request.params.jid),
        userId: user.id,
        domain,
        mucDomain,
      });
      if (!historyLimiter.allow(user.id)) {
        return httpErrorResponse(requestIdOf(request.request), tooManyChanges());
      }
      const deleted = await deleteOwnArchiveRow(service, {
        userId: user.id,
        bare,
        archiveId: request.params.archiveId,
      });
      if (!deleted) {
        throw new HttpError(404, 'not_found', 'Message not found');
      }
    }),
  };
}
// Builds the caller's chat list from contacts, groups, AIs, avatars, topics and marks.

// Each active AI the caller owns is a DM with its own XMPP account.
// It carries the AI's `createdAt` (ISO) so a just-created, still-empty AI chat sorts first, like a group.
// Disabled AIs and other people's AIs are left out; no avatar key when the AI has none.
function aiDmEntries(
  ais: readonly PublicAi[],
  aiAvatars: ReadonlyMap<string, string>,
): ChatListEntry[] {
  return ais
    .filter((ai) => ai.status === 'active')
    .map((ai): ChatListEntry => ({
      kind: 'dm',
      chatJid: ai.jid,
      title: ai.name,
      isAi: true,
      createdAt: ai.createdAt.toISOString(),
      ...(aiAvatars.get(ai.id) === undefined
        ? {}
        : { avatarUrl: avatarUrlFor(aiAvatars.get(ai.id)!) }),
    }));
}
interface ChatUnreadFields {
  unread?: number;
  lastMessage?: ChatUnread['lastMessage'];
  // ISO creation time; an empty chat sorts by it.
  createdAt?: string;
  // Another member's delivered mark in the caller's terms; absent until someone confirms.
  deliveredUntil?: string;
  // A DM peer's read mark, an archive id in the caller's terms.
  readUntil?: string;
}

type ChatListEntry =
  | ({
      kind: 'dm';
      chatJid: string;
      title: string;
      avatarUrl?: string;
      userId?: string;
      isAi: boolean;
    } & ChatUnreadFields)
  | ({
      kind: 'group';
      chatJid: string;
      title: string;
      groupId: string;
      memberCount: number;
      role: GroupRole;
      // The group's picture, when it has one.
      avatarUrl?: string | undefined;
      // `channel` adds `subscriberCount` (same number, channel wording).
      chatKind: 'group' | 'channel';
      subscriberCount?: number;
      description?: string | null;
      // `private` is invite-only, `public` is in the directory.
      visibility: 'private' | 'public';
      // The `@handle` while public, null while private.
      handle: string | null;
      topics: TopicView[];
      // The owner-set background, so the list paints it without a second request.
      background: GroupBackground;
    } & ChatUnreadFields);

function listChatsFor(
  deps: ChatsApiDependencies,
  user: SessionUser,
): Effect.Effect<{ chats: ChatListEntry[] }> {
  const logger = deps.logger;
  return Effect.gen(function* () {
    const [contacts, groups, ais, allowed] = yield* Effect.promise(() =>
      Promise.all([
        listContacts(deps.db, user.id, deps.config.xmpp.domain),
        listGroupsForUser(deps.db, user.id),
        listAis(deps.db, user.id),
        allowedArchives(deps.db, deps.config, user.id),
      ]),
    );
    // Every entry with a picture gets `avatarUrl`; omitted when none.
    const [aiAvatars, groupAvatars] = yield* Effect.promise(() =>
      Promise.all([
        avatarIdsByOwner(
          deps.db,
          'ai',
          ais.filter((ai) => ai.status === 'active').map((ai) => ai.id),
        ),
        avatarIdsByOwner(
          deps.db,
          'group',
          groups.map((group) => group.id),
        ),
      ]),
    );

    const chats: ChatListEntry[] = [
      ...contacts.map((contact): ChatListEntry => ({
        kind: 'dm',
        chatJid: contact.jid,
        title: contact.name,
        userId: contact.userId,
        isAi: false,
        ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
      })),
      // Each active AI the caller owns is a DM, carrying `createdAt` so a new empty chat leads the list.
      ...aiDmEntries(ais, aiAvatars),
      ...groups.map((group): ChatListEntry => ({
        kind: 'group',
        chatJid: `${group.roomLocalpart}@${deps.config.xmpp.mucDomain}`,
        title: group.title,
        groupId: group.id,
        memberCount: group.memberCount,
        role: group.role,
        ...(groupAvatars.get(group.id) === undefined
          ? {}
          : { avatarUrl: avatarUrlFor(groupAvatars.get(group.id)!) }),
        chatKind: group.kind,
        ...(group.kind === 'channel'
          ? { subscriberCount: group.memberCount, description: group.description }
          : {}),
        visibility: group.visibility,
        handle: group.handle,
        topics: [],
        background: group.background,
        createdAt: group.createdAt.toISOString(),
      })),
    ];

    // One batched pass builds each visible group's topics (a channel's feed is its own row).
    const groupEntries = chats.filter(
      (entry): entry is Extract<ChatListEntry, { kind: 'group' }> =>
        entry.kind === 'group' && entry.chatKind !== 'channel',
    );
    const topicsByGroup = yield* Effect.promise(() =>
      visibleTopicsForGroups(
        deps.db,
        groupEntries.map((entry) => entry.groupId),
        user.id,
      ),
    );
    const views = yield* Effect.promise(async () =>
      withTopicActivity(
        deps,
        await toTopicViews(
          deps.db,
          groupEntries.flatMap((entry) => topicsByGroup.get(entry.groupId) ?? []),
          deps.config.xmpp.mucDomain,
          user.id,
        ),
      ),
    );
    // `toTopicViews` sorts General first then by name; splitting keeps that order per group.
    const viewsByGroup = new Map<string, TopicView[]>();
    for (const view of views) {
      const list = viewsByGroup.get(view.groupId) ?? [];
      list.push(view);
      viewsByGroup.set(view.groupId, list);
    }
    for (const entry of groupEntries) {
      entry.topics = viewsByGroup.get(entry.groupId) ?? [];
    }

    // One unread pass and one delivery-marks pass over every listed chat and topic; without an archive pool both are empty.
    // A DM entry names its peer's user id; a group or topic names the room; AI DMs carry no mark.
    const scopes = new Map<string, UnreadScope>();
    const lookups: DeliveryLookup[] = [];
    for (const entry of chats) {
      if (entry.kind === 'dm') {
        scopes.set(entry.chatJid, {
          kind: 'dm',
          peer: entry.chatJid.toLowerCase(),
        });
        if (entry.userId !== undefined) {
          lookups.push({ chatJid: entry.chatJid, dmPeerUserId: entry.userId });
        }
      } else {
        scopes.set(entry.chatJid, { kind: 'room', room: entry.chatJid.toLowerCase() });
        lookups.push({ chatJid: entry.chatJid, roomJid: entry.chatJid });
        for (const topic of entry.topics) {
          // A topic the caller has not joined adds no unread, preview or mark.
          if (!topic.isGeneral && !(topic.memberIds ?? []).includes(user.id)) {
            continue;
          }
          scopes.set(topic.chatJid, { kind: 'room', room: topic.chatJid.toLowerCase() });
          lookups.push({ chatJid: topic.chatJid, roomJid: topic.chatJid });
        }
      }
    }
    const unread = yield* Effect.promise(() =>
      unreadForChats(deps.db, deps.config, deps.archive, user.id, scopes).catch((error) => {
        // An unread or preview failure never fails the list: log one warning and answer without the fields.
        logger.warn(
          {
            errorClass: error?.constructor?.name,
            message: String(error?.message ?? error),
          },
          'unread for chats failed, answering the list without unread fields',
        );
        return {} as Record<string, ChatUnread>;
      }),
    );
    const callerJid = ownBareJid(allowed, deps.config.xmpp.domain);
    const [deliveredMarks, readMarks] = yield* Effect.promise(() =>
      Promise.all([
        deliveredForChats(deps.db, { userId: user.id, callerJid, lookups }),
        readForChats(deps.db, { userId: user.id, callerJid, lookups }),
      ]).catch((error) => {
        logger.warn(
          {
            errorClass: error?.constructor?.name,
            message: String(error?.message ?? error),
          },
          'chat marks failed, answering the list without mark fields',
        );
        return [{}, {}] as [Record<string, string>, Record<string, string>];
      }),
    );
    for (const entry of chats) {
      const fields = unread[entry.chatJid];
      const delivered = deliveredMarks[entry.chatJid];
      if (entry.kind === 'group') {
        entry.topics = mergeTopicMarks(entry.topics, unread, deliveredMarks);
      }
      if (fields !== undefined) {
        entry.unread = fields.unread;
        if (fields.lastMessage !== undefined) {
          entry.lastMessage = fields.lastMessage;
        }
      }
      if (delivered !== undefined) {
        entry.deliveredUntil = delivered;
      }
      const read = entry.kind === 'dm' ? readMarks[entry.chatJid] : undefined;
      if (read !== undefined) entry.readUntil = read;
    }

    chats.sort((a, b) => a.title.localeCompare(b.title));

    return { chats };
  });
}
