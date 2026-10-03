import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import { listAis } from '../ais/service';
import type { ServerConfig } from '../config';
import { listContacts } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { listGroupsForUser, type GroupRole } from '../groups/service';
import { toTopicViews, visibleTopics, type TopicView } from '../topics/access';

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
    };

export interface ChatsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
}

export function createChatsRoutes({ auth, db, config }: ChatsRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/chats', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const [contacts, groups, ais] = await Promise.all([
      listContacts(db, user.id, config.xmpp.domain),
      listGroupsForUser(db, user.id),
      listAis(db, user.id),
    ]);

    const chats: ChatListEntry[] = [
      ...contacts.map((contact): ChatListEntry => ({
        kind: 'dm',
        chatJid: contact.jid,
        title: contact.name,
        userId: contact.userId,
        isAi: false,
        ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
      })),
      // Each active AI the caller owns is a DM with its own XMPP account, so
      // "Open chat" from My AIs has somewhere to land. Disabled AIs and other
      // people's AIs are left out.
      ...ais
        .filter((ai) => ai.status === 'active')
        .map((ai): ChatListEntry => ({
          kind: 'dm',
          chatJid: ai.jid,
          title: ai.name,
          isAi: true,
        })),
      ...groups.map((group): ChatListEntry => ({
        kind: 'group',
        chatJid: `${group.roomLocalpart}@${config.xmpp.mucDomain}`,
        title: group.title,
        groupId: group.id,
        memberCount: group.memberCount,
        role: group.role,
        chatKind: group.kind,
        // T-0124: the same count under the usual channel name, for channels only.
        // Groups keep exactly the shape they had (no extra keys).
        ...(group.kind === 'channel'
          ? { subscriberCount: group.memberCount, description: group.description }
          : {}),
        // T-0164: visibility + handle ride every group entry (the web
        // paints a "Public" label from them); null handle while private.
        visibility: group.visibility,
        handle: group.handle,
        topics: [],
      })),
    ];

    // T-0108: each group entry gains its visible topics. Fetched per group
    // after the list so a group the user cannot see never leaks in.
    for (const entry of chats) {
      if (entry.kind !== 'group') {
        continue;
      }
      const rows = await visibleTopics(db, entry.groupId, user.id);
      entry.topics = await toTopicViews(db, rows, config.xmpp.mucDomain);
    }

    chats.sort((a, b) => a.title.localeCompare(b.title));

    return c.json({ chats });
  });

  return routes;
}
