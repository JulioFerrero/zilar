import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import { listContacts } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { listGroupsForUser, type GroupRole } from '../groups/service';

export type ChatListEntry =
  | { kind: 'dm'; chatJid: string; title: string; avatarUrl?: string; userId: string }
  | {
      kind: 'group';
      chatJid: string;
      title: string;
      groupId: string;
      memberCount: number;
      role: GroupRole;
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
    const [contacts, groups] = await Promise.all([
      listContacts(db, user.id, config.xmpp.domain),
      listGroupsForUser(db, user.id),
    ]);

    const chats: ChatListEntry[] = [
      ...contacts.map((contact): ChatListEntry => ({
        kind: 'dm',
        chatJid: contact.jid,
        title: contact.name,
        userId: contact.userId,
        ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
      })),
      ...groups.map((group): ChatListEntry => ({
        kind: 'group',
        chatJid: `${group.roomLocalpart}@${config.xmpp.mucDomain}`,
        title: group.title,
        groupId: group.id,
        memberCount: group.memberCount,
        role: group.role,
      })),
    ];

    chats.sort((a, b) => a.title.localeCompare(b.title));

    return c.json({ chats });
  });

  return routes;
}
