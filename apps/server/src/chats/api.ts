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
import { putChatRead, requireChatReadAccess } from './reads';
import { unreadForChats, type ChatUnread, type UnreadScope } from './unread';

export const CHAT_READ_RATE_LIMIT_MAX = 600;
export const CHAT_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface ChatUnreadFields {
  unread?: number;
  lastMessage?: ChatUnread['lastMessage'];
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

export type ChatTopicView = TopicView & ChatUnreadFields;

export interface ChatsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  // T-1198: the read-only pool on the ejabberd MAM archive. Required but
  // nullable, so `app.ts` passes it straight through with no new lines;
  // undefined = the list keeps its old shape (no unread, no previews).
  archive: ArchivePool | undefined;
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

  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            const [contacts, groups, ais] = yield* Effect.promise(() =>
              Promise.all([
                listContacts(deps.db, user.id, deps.config.xmpp.domain),
                listGroupsForUser(deps.db, user.id),
                listAis(deps.db, user.id),
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
              })),
            ];

            // T-0108/T-1175: each group entry gains its visible topics. One
            // batched visibility pass and one view build cover every group, so a
            // user in N groups costs a fixed number of queries, not one set per
            // group. A group the user cannot see stays out of the map (and yields
            // no rows), so it never leaks in.
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
            const scopes = new Map<string, UnreadScope>();
            for (const entry of chats) {
              if (entry.kind === 'dm') {
                scopes.set(entry.chatJid, {
                  kind: 'dm',
                  peer: entry.chatJid.toLowerCase(),
                });
              } else {
                scopes.set(entry.chatJid, { kind: 'room', room: entry.chatJid.toLowerCase() });
                for (const topic of entry.topics) {
                  scopes.set(topic.chatJid, { kind: 'room', room: topic.chatJid.toLowerCase() });
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
            for (const entry of chats) {
              const fields = unread[entry.chatJid];
              if (fields !== undefined) {
                if (entry.kind === 'group') {
                  const topics = (entry.topics as ChatTopicView[]).map((topic) => {
                    const topicFields = unread[topic.chatJid];
                    return topicFields === undefined
                      ? topic
                      : {
                          ...topic,
                          unread: topicFields.unread,
                          ...(topicFields.lastMessage === undefined
                            ? {}
                            : { lastMessage: topicFields.lastMessage }),
                        };
                  });
                  entry.topics = topics;
                }
                entry.unread = fields.unread;
                if (fields.lastMessage !== undefined) {
                  entry.lastMessage = fields.lastMessage;
                }
              }
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
          let jid: string;
          try {
            jid = decodeURIComponent(request.params.jid);
          } catch {
            throw new HttpError(404, 'not_found', 'Chat not found');
          }
          const access = {
            chatJid: jid,
            userId: user.id,
            domain: deps.config.xmpp.domain,
            mucDomain: deps.config.xmpp.mucDomain,
          };
          const { bare } = await requireChatReadAccess(deps.db, access);
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
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ChatsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ChatsApi, apiLayer);
}
