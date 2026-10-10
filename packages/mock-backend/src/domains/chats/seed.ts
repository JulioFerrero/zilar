import type { ChatEntry } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import { seedTopicViews } from '../topics/seed';
import { withGeneralTopic } from './general-topics';

// The `/api/chats` seed: DMs (contacts and the viewer's AIs) and groups (a
// channel is a group with `chatKind: 'channel'`), newest first like the old web
// seed. Every `chatJid` is a bare JID: a contact's JID for a DM, an AI's JID for
// an AI DM, a room JID for a group. The apps build their own rows from these
// entries (`summariesFor`), so unread/muted/last-message are not seeded here.
// Like the real server, every group carries its General topic; Dev team keeps
// its seven seeded rows and the rest get one General built by `withGeneralTopic`.
export const chats: readonly ChatEntry[] = [
  { kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana', isAi: false },
  withGeneralTopic({
    kind: 'group',
    chatJid: 'acme@rooms.zilar.test',
    title: 'Acme Announcements',
    groupId: 'g-acme',
    memberCount: 120,
    role: 'owner',
    chatKind: 'channel',
    subscriberCount: 120,
    description: 'Release notes and team news.',
    visibility: 'public',
    handle: 'acme',
  }),
  {
    kind: 'group',
    chatJid: 'dev-team@rooms.zilar.test',
    title: 'Dev team',
    groupId: 'g-devteam',
    memberCount: 6,
    role: 'owner',
    visibility: 'private',
    handle: null,
    topics: seedTopicViews(),
  },
  withGeneralTopic({
    kind: 'group',
    chatJid: 'viernes@rooms.zilar.test',
    title: 'Viernes 🍻',
    groupId: 'g-viernes',
    memberCount: 5,
    role: 'member',
    visibility: 'private',
    handle: null,
  }),
  { kind: 'dm', chatJid: 'ai-dev-1@zilar.test', title: 'Dev AI', isAi: true },
  { kind: 'dm', chatJid: 'marta@zilar.test', title: 'Marta', userId: 'u-marta', isAi: false },
  withGeneralTopic({
    kind: 'group',
    chatJid: 'familia@rooms.zilar.test',
    title: 'Familia',
    groupId: 'g-familia',
    memberCount: 4,
    role: 'owner',
    visibility: 'private',
    handle: null,
  }),
  withGeneralTopic({
    kind: 'group',
    chatJid: 'qa@rooms.zilar.test',
    title: 'QA squad',
    groupId: 'g-qa',
    memberCount: 4,
    role: 'admin',
    visibility: 'private',
    handle: null,
  }),
  { kind: 'dm', chatJid: 'luis@zilar.test', title: 'Luis', userId: 'u-luis', isAi: false },
  { kind: 'dm', chatJid: 'ai-marketing@zilar.test', title: 'Marketing AI', isAi: true },
  withGeneralTopic({
    kind: 'group',
    chatJid: 'gym@rooms.zilar.test',
    title: 'Gym buddies',
    groupId: 'g-gym',
    memberCount: 8,
    role: 'member',
    visibility: 'private',
    handle: null,
  }),
  withGeneralTopic({
    kind: 'group',
    chatJid: 'product@rooms.zilar.test',
    title: 'Product',
    groupId: 'g-product',
    memberCount: 5,
    role: 'owner',
    visibility: 'private',
    handle: null,
  }),
];

/** The chats domain's rows for the combined seed. */
export function seedChats(): Partial<MockSeed> {
  return { chats };
}
