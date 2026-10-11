import type { ChatEntry } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import { groupRoomJid } from './general-topics';

// The `/api/chats` seed: DMs (contacts and the viewer's AIs) and groups (a
// channel is a group with `chatKind: 'channel'`), newest first like the old web
// seed. Every `chatJid` is a bare JID: a contact's JID for a DM, an AI's JID for
// an AI DM, a room JID for a group. The apps build their own rows from these
// entries (`summariesFor`), so unread/muted/last-message are not seeded here.
// Every group's General is a row in the topics table, not on this entry: the
// chat route attaches each group's live topics from there, so the list and the
// topic routes agree and a later topic edit is reflected (T-1090).
export const chats: readonly ChatEntry[] = [
  { kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana', isAi: false },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-acme'),
    title: 'Acme Announcements',
    groupId: 'g-acme',
    memberCount: 120,
    role: 'owner',
    chatKind: 'channel',
    subscriberCount: 120,
    description: 'Release notes and team news.',
    visibility: 'public',
    handle: 'acme',
  },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-devteam'),
    title: 'Dev team',
    groupId: 'g-devteam',
    memberCount: 6,
    role: 'owner',
    visibility: 'private',
    handle: null,
  },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-viernes'),
    title: 'Viernes 🍻',
    groupId: 'g-viernes',
    memberCount: 5,
    role: 'member',
    visibility: 'private',
    handle: null,
  },
  { kind: 'dm', chatJid: 'ai-dev-1@zilar.test', title: 'Dev AI', isAi: true },
  { kind: 'dm', chatJid: 'marta@zilar.test', title: 'Marta', userId: 'u-marta', isAi: false },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-familia'),
    title: 'Familia',
    groupId: 'g-familia',
    memberCount: 4,
    role: 'owner',
    visibility: 'private',
    handle: null,
  },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-qa'),
    title: 'QA squad',
    groupId: 'g-qa',
    memberCount: 4,
    role: 'admin',
    visibility: 'private',
    handle: null,
  },
  { kind: 'dm', chatJid: 'luis@zilar.test', title: 'Luis', userId: 'u-luis', isAi: false },
  { kind: 'dm', chatJid: 'ai-marketing@zilar.test', title: 'Marketing AI', isAi: true },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-gym'),
    title: 'Gym buddies',
    groupId: 'g-gym',
    memberCount: 8,
    role: 'member',
    visibility: 'private',
    handle: null,
  },
  {
    kind: 'group',
    chatJid: groupRoomJid('g-product'),
    title: 'Product',
    groupId: 'g-product',
    memberCount: 5,
    role: 'owner',
    visibility: 'private',
    handle: null,
  },
];

/** The chats domain's rows for the combined seed. */
export function seedChats(): Partial<MockSeed> {
  return { chats };
}
