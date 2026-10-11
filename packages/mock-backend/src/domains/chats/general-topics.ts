// General topics and the seeded groups' rooms. The real server creates a General
// topic in the group's own room for every group
// (`apps/server/src/groups/service.ts:157-171`), so the mock seeds one such row
// per group in the topics table (`domains/topics/seed.ts`) and both
// `/groups/:id/topics` and the topics attached to `/chats` list it (T-1090).
// Dev team's row is one of its seven seeded rows; every other group's is built
// here from the groups seed.
import type { MockTopic } from '../topics/tables';

/**
 * The room JID of the seeded groups whose room is not the group id without its
 * `g-` prefix (`g-devteam` is `dev-team@rooms.zilar.test`). Every other group
 * follows the plain scheme (`g-acme` is `acme@rooms.zilar.test`).
 */
const GROUP_ROOM_JIDS: Readonly<Record<string, string>> = {
  'g-devteam': 'dev-team@rooms.zilar.test',
};

/** The room JID of a group: its own room, where its General topic lives. */
export function groupRoomJid(groupId: string): string {
  return GROUP_ROOM_JIDS[groupId] ?? `${groupId.replace(/^g-/, '')}@rooms.zilar.test`;
}

/** The General topic's stable mock id, mirroring the Dev team seed's scheme. */
function generalTopicId(groupId: string): string {
  return `t-${groupId.replace(/^g-/, '')}-general`;
}

/** The live-shaped General row: the same fields the server inserts on create. */
export function generalTopicRow(groupId: string, chatJid: string): MockTopic {
  return {
    id: generalTopicId(groupId),
    groupId,
    name: 'General',
    glyph: 'G',
    chatJid,
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
