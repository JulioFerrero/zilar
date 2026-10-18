// Builds the caller's chat list from contacts, groups, AIs, avatars, topics and marks.

import { Effect } from 'effect';
import { listAis } from '../ais/queries';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { listContacts } from '../contacts/service';
import type { SessionUser } from '../effect/http-core';
import { listGroupsForUser, type GroupBackground, type GroupRole } from '../groups/service';
import { ownBareJid } from '../jid';
import { allowedArchives } from '../search/service';
import { toTopicViews, type TopicView } from '../topics/access';
import { withTopicActivity } from '../topics/ai-activity';
import { visibleTopicsForGroups } from '../topics/visible-batch';
import type { ChatsApiDependencies } from './api';
import { aiDmEntries } from './ai-entries';
import { deliveredForChats, mergeTopicMarks, type DeliveryLookup } from './deliveries';
import { readForChats } from './reads';
import { unreadForChats, type ChatUnread, type UnreadScope } from './unread';

export interface ChatUnreadFields {
  unread?: number;
  lastMessage?: ChatUnread['lastMessage'];
  // ISO creation time; an empty chat sorts by it.
  createdAt?: string;
  // Another member's delivered mark in the caller's terms; absent until someone confirms.
  deliveredUntil?: string;
  // A DM peer's read mark, an archive id in the caller's terms.
  readUntil?: string;
}

export type ChatListEntry =
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

export function listChatsFor(
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
