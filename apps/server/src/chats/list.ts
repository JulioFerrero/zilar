// effect-plain: list assembly is a Promise over read-only queries; there is no Effect service to compose here.
import type { ChatEntry } from '@zilar/api-contract';
import { listAis } from '../ais/queries';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { listContacts } from '../contacts/service';
import { listGroupsForUser } from '../groups/queries';
import { ownBareJid } from '../jid';
import { allowedArchives } from '../search/service';
import type { TopicView } from '../topics/access';
import { withTopicActivity } from '../topics/ai-activity';
import { visibleTopicsForGroups } from '../topics/visible-batch';
import { toTopicViews } from '../topics/views';
import { deliveredForChats, mergeTopicMarks, type DeliveryLookup } from './deliveries';
import { readForChats } from './reads';
import { unreadForChats, type ChatUnread, type UnreadScope } from './unread';
import type { ChatsApiDependencies } from './api';
export async function listChats(
  deps: ChatsApiDependencies,
  userId: string,
): Promise<{ chats: ChatEntry[] }> {
  const { db, config, logger } = deps;
  const [contacts, groups, aisByOwner, allowed] = await Promise.all([
    listContacts(db, userId, config.xmpp.domain),
    listGroupsForUser(db, userId),
    listAis(db, userId),
    allowedArchives(db, config, userId),
  ]);
  const [aiAvatars, groupAvatars] = await Promise.all([
    avatarIdsByOwner(
      db,
      'ai',
      aisByOwner.filter((ai) => ai.status === 'active').map((ai) => ai.id),
    ),
    avatarIdsByOwner(
      db,
      'group',
      groups.map((group) => group.id),
    ),
  ]);
  const chats: ChatEntry[] = [
    ...contacts.map((contact) => ({
      kind: 'dm' as const,
      chatJid: contact.jid,
      title: contact.name,
      userId: contact.userId,
      isAi: false,
      ...(contact.avatarUrl ? { avatarUrl: contact.avatarUrl } : {}),
    })),
    ...aisByOwner
      .filter((ai) => ai.status === 'active')
      .map((ai) => ({
        kind: 'dm' as const,
        chatJid: ai.jid,
        title: ai.name,
        isAi: true,
        createdAt: ai.createdAt.toISOString(),
        ...(aiAvatars.get(ai.id) === undefined
          ? {}
          : { avatarUrl: avatarUrlFor(aiAvatars.get(ai.id)!) }),
      })),
    ...groups.map((group) => ({
      kind: 'group' as const,
      chatJid: `${group.roomLocalpart}@${config.xmpp.mucDomain}`,
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
  const groupEntries = chats.filter(
    (entry): entry is Extract<ChatEntry, { kind: 'group' }> =>
      entry.kind === 'group' && entry.chatKind !== 'channel',
  );
  const topicsByGroup = await visibleTopicsForGroups(
    db,
    groupEntries.map((entry) => entry.groupId),
    userId,
  );
  const views = await withTopicActivity(
    deps,
    await toTopicViews(
      db,
      groupEntries.flatMap((entry) => topicsByGroup.get(entry.groupId) ?? []),
      config.xmpp.mucDomain,
      userId,
    ),
  );
  const viewsByGroup = new Map<string, TopicView[]>();
  for (const view of views)
    viewsByGroup.set(view.groupId, [...(viewsByGroup.get(view.groupId) ?? []), view]);
  for (const entry of groupEntries) entry.topics = viewsByGroup.get(entry.groupId) ?? [];
  const scopes = new Map<string, UnreadScope>();
  const lookups: DeliveryLookup[] = [];
  for (const entry of chats) {
    const jid = entry.chatJid.toLowerCase();
    scopes.set(
      entry.chatJid,
      entry.kind === 'dm' ? { kind: 'dm', peer: jid } : { kind: 'room', room: jid },
    );
    if (entry.kind === 'dm') {
      if (entry.userId !== undefined) {
        lookups.push({ chatJid: entry.chatJid, dmPeerUserId: entry.userId });
      }
      continue;
    }
    lookups.push({ chatJid: entry.chatJid, roomJid: entry.chatJid });
    for (const topic of (entry.topics ?? []) as TopicView[]) {
      if (!topic.isGeneral && !(topic.memberIds ?? []).includes(userId)) continue;
      scopes.set(topic.chatJid, { kind: 'room', room: topic.chatJid.toLowerCase() });
      lookups.push({ chatJid: topic.chatJid, roomJid: topic.chatJid });
    }
  }
  const unread: Record<string, ChatUnread> = await unreadForChats(
    db,
    config,
    deps.archive,
    userId,
    scopes,
  ).catch((error) => {
    logger.warn(
      { errorClass: error instanceof Error ? error.name : undefined, message: String(error) },
      'unread for chats failed',
    );
    return {};
  });
  const callerJid = ownBareJid(allowed, config.xmpp.domain);
  let deliveredMarks: Record<string, string> = {};
  let readMarks: Record<string, string> = {};
  try {
    [deliveredMarks, readMarks] = await Promise.all([
      deliveredForChats(db, { userId, callerJid, lookups }),
      readForChats(db, { userId, callerJid, lookups }),
    ]);
  } catch (error) {
    logger.warn(
      { errorClass: error instanceof Error ? error.name : undefined, message: String(error) },
      'chat marks failed',
    );
  }
  for (const entry of chats) {
    const fields = unread[entry.chatJid];
    if (entry.kind === 'group') {
      entry.topics = mergeTopicMarks((entry.topics ?? []) as TopicView[], unread, deliveredMarks);
    }
    if (fields !== undefined) {
      entry.unread = fields.unread;
      if (fields.lastMessage !== undefined) entry.lastMessage = fields.lastMessage;
    }
    const delivered = deliveredMarks[entry.chatJid];
    if (delivered !== undefined) entry.deliveredUntil = delivered;
    if (entry.kind === 'dm' && readMarks[entry.chatJid] !== undefined) {
      entry.readUntil = readMarks[entry.chatJid];
    }
  }
  chats.sort((a, b) => a.title.localeCompare(b.title));
  return { chats };
}
