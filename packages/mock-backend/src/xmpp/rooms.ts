// Room membership and occupants for the fake XMPP core. The seed does not list a
// room's members, so they are the bare JIDs that posted in the room's thread,
// with the viewer excluded. A room with no posts (a new topic) takes its
// members from its topic's group instead. The fake reply to a room send comes
// from them.
import type { Occupant } from '@zilar/xmpp-core';
import type { MockData } from '../state';

/**
 * The bare JIDs of the room's group members, the viewer excluded, or
 * `undefined` when no topic or group matches `roomJid`.
 */
function groupMembers(data: MockData, roomJid: string): string[] | undefined {
  const topic = data.topics.find((entry) => entry.chatJid === roomJid);
  const group = topic === undefined ? undefined : data.findGroup(topic.groupId);
  if (group === undefined) {
    return undefined;
  }
  const mine = data.me.jid;
  const members: string[] = [];
  for (const member of group.members) {
    const person = data.people.find((entry) => entry.id === member.userId);
    if (person !== undefined && person.jid !== mine) {
      members.push(person.jid);
    }
  }
  return members;
}

/** The distinct bare JIDs of the seeded members who posted in `roomJid`. */
export function seededMembers(data: MockData, roomJid: string): string[] {
  const mine = data.me.jid;
  const members = new Set<string>();
  for (const message of data.messages[roomJid] ?? []) {
    if (message.fromResolved && message.fromJid !== mine) {
      members.add(message.fromJid);
    }
  }
  if (members.size === 0) {
    const fromGroup = groupMembers(data, roomJid);
    if (fromGroup === undefined) {
      for (const person of data.people) {
        if (person.jid !== mine) {
          members.add(person.jid);
        }
      }
    } else {
      for (const jid of fromGroup) {
        members.add(jid);
      }
    }
  }
  return [...members];
}

/** A person's display name, falling back to the JID's local part. */
export function nameFor(data: MockData, jid: string): string {
  const person = data.people.find((entry) => entry.jid === jid);
  if (person !== undefined) {
    return person.name;
  }
  return jid.split('@')[0] ?? jid;
}

/** The occupants of `roomJid`: the viewer plus the seeded members. */
export function occupantList(data: MockData, roomJid: string, myNick: string): Occupant[] {
  const others = seededMembers(data, roomJid).map((jid): Occupant => {
    const nick = nameFor(data, jid);
    return { jid: `${roomJid}/${nick}`, nick, realJid: jid, available: true };
  });
  return [
    { jid: `${roomJid}/${myNick}`, nick: myNick, realJid: data.me.jid, available: true },
    ...others,
  ];
}

/** The seeded member to answer the next room send, round-robin over the thread. */
export function nextReplyMember(
  data: MockData,
  roomJid: string,
  turn: number,
): { jid: string; nick: string } | undefined {
  const members = seededMembers(data, roomJid);
  const jid = members[turn % members.length];
  if (jid === undefined) {
    return undefined;
  }
  return { jid, nick: nameFor(data, jid) };
}
