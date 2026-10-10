// General topics for the seeded groups that carry none of their own. The real
// server creates a General topic in the group's own room for every group
// (`apps/server/src/groups/service.ts:157-171`) and `GET /chats` attaches the
// visible topics, General first (`apps/server/src/chats/api.ts:50`). Dev team's
// seven rows come from the topics seed; every other group builds its General
// here, so the mobile group and channel screens can open (T-1048).
import type { GroupChatEntry, Topic } from '@zilar/api-contract';
import type { MockTopic } from '../topics/tables';
import { buildTopicView, type TopicViewSource } from '../topics/view';

/** The General topic's stable mock id, mirroring the Dev team seed's scheme. */
function generalTopicId(entry: GroupChatEntry): string {
  return `t-${entry.groupId.replace(/^g-/, '')}-general`;
}

/** The live-shaped General row: the same fields the server inserts on create. */
function generalTopicRow(entry: GroupChatEntry): MockTopic {
  return {
    id: generalTopicId(entry),
    groupId: entry.groupId,
    name: 'General',
    glyph: 'G',
    chatJid: entry.chatJid,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
    archived: false,
    memberIds: [],
    aiIds: [],
    roleIds: [],
    approverRoleId: null,
  };
}

/**
 * One group's visible General topic, built through the topics domain's
 * `buildTopicView` so it matches a live row. General is public and role-less, so
 * its member count is the group's whole count, the number the entry shows.
 */
export function generalTopicView(entry: GroupChatEntry): Topic {
  const source: TopicViewSource = {
    groupMemberCount: () => entry.memberCount,
    role: () => undefined,
    aiName: () => 'An AI',
  };
  return buildTopicView(generalTopicRow(entry), source);
}

/**
 * The same group entry with its General topic attached, for groups the topics
 * seed leaves empty. The chat route keeps this list only while the live topics
 * table has none for the group, so a later topic edit still replaces it.
 */
export function withGeneralTopic(entry: GroupChatEntry): GroupChatEntry {
  return { ...entry, topics: [generalTopicView(entry)] };
}
