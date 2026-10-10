// The chats list on the Effect `HttpApi` adapter (T-0533): the same method,
// path and answer as the deleted router (`routes.ts`), mounted by the Effect
// edge (`apps/server/src/effect/edge.ts`). Its services run on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import { listAis } from '../ais/service';
import type { Auth } from '../auth/auth';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import { listContacts } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { listGroupsForUser, type GroupBackground, type GroupRole } from '../groups/service';
import { toTopicViews, visibleTopics, type TopicView } from '../topics/access';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';

export type ChatListEntry =
  | {
      kind: 'dm';
      chatJid: string;
      title: string;
      avatarUrl?: string;
      userId?: string;
      /** True for an AI the caller owns, false for a human contact. */
      isAi: boolean;
    }
  | {
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
    };

export interface ChatsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
}

// The chat list is a discriminated union already typed by `ChatListEntry`; the
// schema passes each entry through unchanged, so the wire shape stays exactly
// what the old route returned (a named Struct would drop keys it does not
// list).
const ChatsResult = Schema.Struct({
  chats: Schema.Array(Schema.Unknown),
});

const ChatsGroup = HttpApiGroup.make('chats')
  .add(HttpApiEndpoint.get('list', '/chats', { success: ChatsResult }))
  .middleware(Session)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const ChatsApi = HttpApi.make('chats').add(ChatsGroup);

export function createChatsApi(deps: ChatsApiDependencies): EffectApiMount {
  const logger = deps.logger;

  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers.handle(
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

          // T-0108: each group entry gains its visible topics. Fetched per
          // group after the list so a group the user cannot see never leaks in.
          for (const entry of chats) {
            if (entry.kind !== 'group') {
              continue;
            }
            const rows = yield* Effect.promise(() =>
              visibleTopics(deps.db, entry.groupId, user.id),
            );
            entry.topics = yield* Effect.promise(() =>
              toTopicViews(deps.db, rows, deps.config.xmpp.mucDomain),
            );
          }

          chats.sort((a, b) => a.title.localeCompare(b.title));

          return { chats };
        }),
      ),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(ChatsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(ChatsApi, apiLayer);
}
