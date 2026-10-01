import type { ChatSummary } from '../lib/types';
import { at } from './time';

/**
 * The two demo channels (T-0144, the mobile twin of the web mock's "Acme
 * Announcements"): one where the viewer subscribes, one where they manage.
 * Each channel is a single General feed row (a channel has exactly one
 * topic, its feed — T-0124), carrying the channel fields (`chatKind`,
 * `subscriberCount`, `description`, `myRole`) like the real store maps
 * them. The details mirror the server rule: managers read the full
 * audience, subscribers the owner/admins slice (enforced by the store, the
 * seed keeps everyone and the selector slices).
 */

export type MockChannelRole = 'owner' | 'admin' | 'member';

export interface MockChannelMember {
  userId: string;
  name: string;
  role: MockChannelRole;
}

interface ChannelSeed {
  groupId: string;
  title: string;
  description: string;
  subscriberCount: number;
  feedId: string;
  lastText: string;
  lastSenderId: string;
  lastSenderName: string;
  members: MockChannelMember[];
}

const CHANNEL_SEEDS: ChannelSeed[] = [
  {
    // The viewer subscribes here: the composer is read-only, the panel
    // shows the admins slice, never the audience.
    groupId: 'g-acme',
    title: 'Acme Announcements',
    description: 'Release notes and team news.',
    subscriberCount: 4,
    feedId: 'c-acme',
    lastText: 'Version 2.4 is out.',
    lastSenderId: 'u-rita',
    lastSenderName: 'Rita',
    members: [
      { userId: 'u-rita', name: 'Rita', role: 'owner' },
      { userId: 'u-ana', name: 'Ana', role: 'admin' },
      { userId: 'me', name: 'You', role: 'member' },
      { userId: 'u-luis', name: 'Luis', role: 'member' },
    ],
  },
  {
    // The viewer owns here: the composer stays, the panel manages the
    // audience (promote/demote) and the invite links.
    groupId: 'g-studio',
    title: 'Studio Updates',
    description: 'What the studio ships.',
    subscriberCount: 2,
    feedId: 'c-studio',
    lastText: 'New canvas tools landed.',
    lastSenderId: 'me',
    lastSenderName: 'You',
    members: [
      { userId: 'me', name: 'You', role: 'owner' },
      { userId: 'u-luis', name: 'Luis', role: 'member' },
    ],
  },
];

// In-memory members per group id, so role writes land like the server's
// (the feed rows read `myRole` from here for the viewer).
let membersByGroup: Record<string, MockChannelMember[]> = {};

function seedMembers(): Record<string, MockChannelMember[]> {
  return Object.fromEntries(
    CHANNEL_SEEDS.map((seed) => [seed.groupId, seed.members.map((member) => ({ ...member }))]),
  );
}

membersByGroup = seedMembers();

/** Resets the channel members to the seeds (one mock store per test). */
export function resetMockChannels(): void {
  membersByGroup = seedMembers();
}

function seedOf(groupId: string): ChannelSeed | undefined {
  return CHANNEL_SEEDS.find((seed) => seed.groupId === groupId);
}

/** The feed rows of both demo channels, newest first. */
export function mockChannelChats(): ChatSummary[] {
  return CHANNEL_SEEDS.map((seed) => {
    const myRole = membersByGroup[seed.groupId]?.find((member) => member.userId === 'me')?.role;
    return {
      id: seed.feedId,
      title: seed.title,
      kind: 'group',
      isAI: false,
      space: 'personal',
      unread: 0,
      muted: false,
      memberCount: seed.subscriberCount,
      onlineCount: 0,
      chatKind: 'channel',
      subscriberCount: seed.subscriberCount,
      description: seed.description,
      ...(myRole === undefined ? {} : { myRole }),
      lastMessage: {
        id: `mock-${seed.feedId}-last`,
        chatId: seed.feedId,
        senderId: seed.lastSenderId,
        senderName: seed.lastSenderName,
        text: seed.lastText,
        createdAt: at(0, 9, 30),
        status: 'read',
      },
      groupId: seed.groupId,
      groupTitle: seed.title,
      topic: {
        id: `t-${seed.feedId}`,
        glyph: 'G',
        kind: 'chat',
        status: 'open',
        visibility: 'public',
        isGeneral: true,
        archived: false,
        owner: null,
        linkUrl: null,
        linkLabel: null,
      },
    };
  });
}

/** The channel detail for the group screen (people + kind + blurb). */
export function mockChannelDetail(groupId: string):
  | {
      id: string;
      title: string;
      createdBy: string;
      kind: 'channel';
      description: string;
      membersCanCreateTopics: boolean;
      members: (MockChannelMember & { roles: { id: string; name: string }[] })[];
      ais: { aiId: string; jid: string; name: string; ownerId: string }[];
    }
  | undefined {
  const seed = seedOf(groupId);
  const members = membersByGroup[groupId];
  if (seed === undefined || members === undefined) {
    return undefined;
  }
  const owner = members.find((member) => member.role === 'owner');
  return {
    id: seed.groupId,
    title: seed.title,
    createdBy: owner?.userId ?? members[0]?.userId ?? 'me',
    kind: 'channel',
    description: seed.description,
    membersCanCreateTopics: false,
    members: members.map((member) => ({ ...member, roles: [] })),
    ais: [],
  };
}

/**
 * In-memory promote/demote on a demo channel (the mock store calls this
 * after its owner check). Demoting the last poster (no owner/admin would
 * remain) rejects with 409 `channel_needs_admin`, like the server's
 * last-admin guard; an unknown member rejects with 404.
 */
export function mockChangeChannelRole(
  groupId: string,
  userId: string,
  role: 'admin' | 'member',
): void {
  const members = membersByGroup[groupId];
  if (members === undefined) {
    throw Object.assign(new Error('Group not found'), { status: 404, code: 'not_found' });
  }
  const target = members.find((member) => member.userId === userId);
  if (target === undefined) {
    throw Object.assign(new Error('Group not found'), { status: 404, code: 'not_found' });
  }
  if (target.role !== 'member' && role === 'member') {
    const remaining = members.filter(
      (member) => member.userId !== userId && member.role !== 'member',
    );
    if (remaining.length === 0) {
      throw Object.assign(new Error('The channel needs at least one admin.'), {
        status: 409,
        code: 'channel_needs_admin',
      });
    }
  }
  target.role = role;
}
