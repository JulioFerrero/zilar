// The chats list on the Effect `HttpApi` adapter (T-0533): the same method,
// path and answer as the deleted router (`routes.ts`), mounted by the Effect
// edge (`apps/server/src/effect/edge.ts`). Its services run on effect/sql.

import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ChatsGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { listAis } from '../ais/service';
import type { Auth } from '../auth/auth';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import { listContacts } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { listGroupsForUser, type GroupBackground, type GroupRole } from '../groups/service';
import { type ArchivePool } from '../search/service';
import { toTopicViews, type TopicView } from '../topics/access';
import { visibleTopicsForGroups } from '../topics/visible-batch';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
import { HttpError } from '../errors';
import { httpErrorResponse, requestIdOf } from '../effect/http-core';
import { ownBareJid } from '../jid';
import { allowedArchives } from '../search/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { putChatRead, readForChats, requireChatReadAccess } from './reads';
import { deliveredForChats, mergeTopicMarks, type DeliveryLookup } from './deliveries';
import { deleteOwnHandlers } from './delete-own';
import { markDeliveredAndNotify } from './delivered-notice';
import { unreadForChats, type ChatUnread, type UnreadScope } from './unread';

export const CHAT_READ_RATE_LIMIT_MAX = 600;
export const CHAT_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface ChatUnreadFields {
  unread?: number;
  lastMessage?: ChatUnread['lastMessage'];
  /** T-1318: the chat's creation time (ISO); an empty chat sorts by it. */
  createdAt?: string;
  /** T-1229: another member's delivered mark, in the caller's own-message
   * terms. Absent when nobody confirmed yet or without archive. */
  deliveredUntil?: string;
  /** T-1311: a DM peer's read mark, an archive id in the caller's terms. */
  readUntil?: string;
}

export type ChatListEntry =
  | ({
      kind: 'dm';
      chatJid: string;
      title: string;
      avatarUrl?: string;
      userId?: string;
      /** True for an AI the caller owns, false for a human contact. */
      isAi: boolean;
    } & ChatUnreadFields)
  | ({
      kind: 'group';
      chatJid: string;
      title: string;
      groupId: string;
      memberCount: number;
      role: GroupRole;
      /** T-0165: the group's picture, when it has one. Omitted when none. */
      avatarUrl?: string | undefined;
      // T-0124: `group` behaves as before; `channel` is the broadcast feed
      // (its General topic is the feed). Channels also carry the count under
      // `subscriberCount` (same number, the usual channel wording).
      chatKind: 'group' | 'channel';
      subscriberCount?: number;
      /** The channel's short blurb, or null. Absent on groups. */
      description?: string | null;
      // T-0164: `private` stays invite-only; `public` is in the directory.
      // The web paints a "Public" label from these, like the CHANNEL tag.
      visibility: 'private' | 'public';
      /** The group's `@handle` while public, null while private. */
      handle: string | null;
      /** Visible topics (archived excluded); General keeps the group chatJid. */
      topics: TopicView[];
      // T-0465: the group background set by an owner/admin, so the list can
      // paint it without a second request.
      background: GroupBackground;
    } & ChatUnreadFields);

// The normalised bare JID a mark may be stored under. A malformed param
// answers the same 404 as an unknown or invisible chat, so JIDs cannot be
// probed.
async function chatAccessForMark(
  deps: ChatsApiDependencies,
  encodedJid: string,
  userId: string,
): Promise<{ bare: string }> {
  let jid: string;
  try {
    jid = decodeURIComponent(encodedJid);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  return requireChatReadAccess(deps.db, {
    chatJid: jid,
    userId,
    domain: deps.config.xmpp.domain,
    mucDomain: deps.config.xmpp.mucDomain,
  });
}

export interface ChatsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  // T-1198: the read-only pool on the ejabberd MAM archive. Required but
  // nullable, so `app.ts` passes it straight through with no new lines;
  // undefined = the list keeps its old shape (no unread, no previews).
  archive: ArchivePool | undefined;
  // T-1245: the ejabberd admin client the live delivered notice sends through.
  // Optional: with no client the notice is skipped and nothing else changes.
  adminClient?: EjabberdAdminClient;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

// The chat list is a discriminated union already typed by `ChatListEntry`; the
// contract's schema (`@zilar/api-contract`, T-0894) passes each entry through
// unchanged, so the wire shape stays exactly what the old route returned.
const ChatsApi = HttpApi.make('chats').add(ChatsGroup);

export function createChatsApi(deps: ChatsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const readLimiter = createRateLimiter({
    max: CHAT_READ_RATE_LIMIT_MAX,
    windowMs: CHAT_READ_RATE_LIMIT_WINDOW_MS,
    now,
  });
  // T-1236: both DM delete handlers (their own limiter + audit recorder live in
  // `delete-own.ts`), built here so `api.ts` stays inside its 400-line bar.
  const deleteOwn = deleteOwnHandlers(deps);

  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            const [contacts, groups, ais, allowed] = yield* Effect.promise(() =>
              Promise.all([
                listContacts(deps.db, user.id, deps.config.xmpp.domain),
                listGroupsForUser(deps.db, user.id),
                listAis(deps.db, user.id),
                allowedArchives(deps.db, deps.config, user.id),
              ]),
            );
            // T-0165: every list entry that already carries a name gets
            // `avatarUrl` when a picture exists (omitted when none, like today).
            // AI ids in the chat list are the AI rows' ids; group entries use the
            // group id.
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
              // Each active AI the caller owns is a DM with its own XMPP account,
              // so "Open chat" from My AIs has somewhere to land. Disabled AIs
              // and other people's AIs are left out.
              ...ais
                .filter((ai) => ai.status === 'active')
                .map((ai): ChatListEntry => ({
                  kind: 'dm',
                  chatJid: ai.jid,
                  title: ai.name,
                  isAi: true,
                  ...(aiAvatars.get(ai.id) === undefined
                    ? {}
                    : { avatarUrl: avatarUrlFor(aiAvatars.get(ai.id)!) }),
                })),
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
                // T-0124: the same count under the usual channel name, for
                // channels only. Groups keep exactly the shape they had (no extra
                // keys).
                ...(group.kind === 'channel'
                  ? { subscriberCount: group.memberCount, description: group.description }
                  : {}),
                // T-0164: visibility + handle ride every group entry (the web
                // paints a "Public" label from them); null handle while private.
                visibility: group.visibility,
                handle: group.handle,
                topics: [],
                background: group.background,
                createdAt: group.createdAt.toISOString(),
              })),
            ];

            // T-0108/T-1175: one batched pass builds every group's visible
            // topics, so a user in N groups costs a fixed number of queries; a
            // group the user cannot see stays out of the map (yields no rows).
            const groupEntries = chats.filter(
              (entry): entry is Extract<ChatListEntry, { kind: 'group' }> => entry.kind === 'group',
            );
            const topicsByGroup = yield* Effect.promise(() =>
              visibleTopicsForGroups(
                deps.db,
                groupEntries.map((entry) => entry.groupId),
                user.id,
              ),
            );
            const views = yield* Effect.promise(() =>
              toTopicViews(
                deps.db,
                groupEntries.flatMap((entry) => topicsByGroup.get(entry.groupId) ?? []),
                deps.config.xmpp.mucDomain,
              ),
            );
            // `toTopicViews` sorts General-first then by name; splitting its
            // result by group keeps that order within each group.
            const viewsByGroup = new Map<string, TopicView[]>();
            for (const view of views) {
              const list = viewsByGroup.get(view.groupId) ?? [];
              list.push(view);
              viewsByGroup.set(view.groupId, list);
            }
            for (const entry of groupEntries) {
              entry.topics = viewsByGroup.get(entry.groupId) ?? [];
            }

            // T-1198: one unread pass over every listed chat (DMs, each group's
            // General jid and every visible topic). Without an archive pool the
            // answer is empty and the list keeps its old shape.
            // T-1229: one delivery-marks pass over every listed chat and
            // topic alongside it. A DM entry names its peer's user id (the
            // mark lives under the caller's own JID); a group or topic entry
            // names the room (the max over other members). AI DMs carry no
            // user id, so they never have a mark.
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
                  scopes.set(topic.chatJid, { kind: 'room', room: topic.chatJid.toLowerCase() });
                  lookups.push({ chatJid: topic.chatJid, roomJid: topic.chatJid });
                }
              }
            }
            const unread = yield* Effect.promise(() =>
              unreadForChats(deps.db, deps.config, deps.archive, user.id, scopes).catch((error) => {
                // An unread or preview failure never fails the list (T-1205):
                // log one warning and answer the chats without the fields.
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
            // T-1229/T-1311: the delivery- and read-marks passes, best effort.
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
          }),
        ),
      )
      // The caller's read mark for one chat. Access is checked before the
      // write budget is charged, so a probe of an invisible chat costs
      // nothing and answers the same 404 as an unknown chat.
      .handle(
        'markRead',
        handler(logger, async (request, user) => {
          const { bare } = await chatAccessForMark(deps, request.params.jid, user.id);
          if (!readLimiter.allow(user.id)) {
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
        }),
      )
      // The receiving device's delivery confirmation. Access is checked
      // before the write budget is charged, like the read mark, so a probe
      // of an invisible chat costs nothing and answers the same 404 as an
      // unknown chat.
      .handle(
        'markDelivered',
        handler(logger, async (request, user) => {
          const { bare } = await chatAccessForMark(deps, request.params.jid, user.id);
          if (!readLimiter.allow(user.id)) {
            return httpErrorResponse(
              requestIdOf(request.request),
              new HttpError(429, 'rate_limited', 'Too many delivered updates, try again later'),
            );
          }
          // One call: store the mark and (for a moved DM) tell the author's
          // online devices, best effort and off the HTTP path (T-1245).
          await markDeliveredAndNotify(deps, {
            bare,
            userId: user.id,
            originIds: request.payload.originIds,
          });
        }),
      )
      // T-1236: the caller's own copy of a DM, both bodies in `delete-own.ts`.
      .handle('clearHistory', deleteOwn.clearHistory)
      .handle('deleteForMe', deleteOwn.deleteForMe),
  );

  const apiLayer = HttpApiBuilder.layer(ChatsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ChatsApi, apiLayer);
}
