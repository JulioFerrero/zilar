// The mock's group registry, shared by the directory search, the by-handle
// lookup, the open join and the invite links. It is derived, not seeded: a
// group is "joined" exactly when it appears in `data.chats`, so a join is one
// append to the chats table. The public groups a directory-only demo adds
// (which the viewer is not in) live in `DIRECTORY_GROUPS`; the chats seed keeps
// the groups the viewer already belongs to.
import type {
  ChatEntry,
  DirectoryEntry,
  GroupChatEntry,
  GroupJoinResult,
} from '@zilar/api-contract';
import type { MockData } from '../../state';

/** One group or channel the directory, the by-handle lookup and the joins see. */
export interface MockGroupInfo {
  readonly id: string;
  readonly chatJid: string;
  readonly kind: 'group' | 'channel';
  readonly title: string;
  readonly handle: string | null;
  readonly description: string | null;
  readonly memberCount: number;
  readonly visibility: 'private' | 'public';
  /** True when the viewer belongs: the group is in `/chats`. */
  readonly joined: boolean;
}

// Public groups and channels the Explore screen demos that the viewer is not in
// (the chats seed only carries the groups the viewer already belongs to). They
// are pure data; a join turns one into a `ChatEntry` in `data.chats`.
export const DIRECTORY_GROUPS: readonly Omit<MockGroupInfo, 'joined'>[] = [
  {
    id: 'g-hiking',
    chatJid: 'hiking@rooms.zilar.test',
    kind: 'group',
    title: 'Hiking club',
    handle: 'hiking_club',
    description: 'Weekend trails and maps.',
    memberCount: 42,
    visibility: 'public',
  },
  {
    id: 'g-news',
    chatJid: 'news@rooms.zilar.test',
    kind: 'channel',
    title: 'Zilar news',
    handle: 'zilar_news',
    description: 'Release notes and outages.',
    memberCount: 1300,
    visibility: 'public',
  },
  {
    id: 'g-cooking',
    chatJid: 'cooking@rooms.zilar.test',
    kind: 'group',
    title: 'Cooking',
    handle: 'cooking',
    description: null,
    memberCount: 7,
    visibility: 'public',
  },
  {
    id: 'g-neighbors',
    chatJid: 'neighbors@rooms.zilar.test',
    kind: 'group',
    title: 'Neighbors',
    handle: 'neighbors',
    description: 'Building news and lost keys.',
    memberCount: 8,
    visibility: 'public',
  },
];

/** Every known group, the viewer's chats first, then the unjoined public ones. */
export function groupRows(data: MockData): readonly MockGroupInfo[] {
  const joined: MockGroupInfo[] = [];
  for (const entry of data.chats) {
    if (entry.kind !== 'group') {
      continue;
    }
    joined.push({
      id: entry.groupId,
      chatJid: entry.chatJid,
      kind: entry.chatKind ?? 'group',
      title: entry.title,
      handle: entry.handle ?? null,
      description: entry.description ?? null,
      memberCount: entry.memberCount,
      visibility: entry.visibility ?? 'private',
      joined: true,
    });
  }
  const known = new Set(joined.map((row) => row.id));
  const extra = DIRECTORY_GROUPS.filter((row) => !known.has(row.id)).map((row) => ({
    ...row,
    joined: false,
  }));
  return [...joined, ...extra];
}

export function findGroup(data: MockData, id: string): MockGroupInfo | undefined {
  return groupRows(data).find((row) => row.id === id);
}

/** The public groups the directory lists: a handle and `visibility: public`. */
export function publicGroups(data: MockData): readonly MockGroupInfo[] {
  return groupRows(data).filter((row) => row.visibility === 'public' && row.handle !== null);
}

/** An exact `@handle` match, case-insensitively, over the public groups. */
export function findPublicGroupByHandle(data: MockData, raw: string): MockGroupInfo | undefined {
  const wanted = raw.trim().toLowerCase();
  return publicGroups(data).find((row) => row.handle?.toLowerCase() === wanted);
}

/** One directory row, the shape `DirectoryEntry` declares. */
export function directoryEntryOf(row: MockGroupInfo): DirectoryEntry {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    handle: row.handle ?? '',
    description: row.description,
    memberCount: row.memberCount,
    joined: row.joined,
  };
}

/**
 * Join the viewer: already a member is a no-op, otherwise the group becomes a
 * `ChatEntry` on `/chats`, the way the real server records the membership.
 * `undefined` means the group is unknown.
 */
export function joinGroup(data: MockData, id: string): GroupJoinResult | undefined {
  const row = findGroup(data, id);
  if (row === undefined) {
    return undefined;
  }
  if (row.joined) {
    return { groupId: row.id, alreadyMember: true };
  }
  addChat(data, chatEntryOf(row));
  return { groupId: row.id, alreadyMember: false };
}

// `chats` is read-only on `MockData`, but the chats slice exposes its array as a
// plain writable property on the merged object. Replacing the array (never
// pushing) leaves the shared seed array untouched, so a `reset()` rebuilds
// cleanly. This is the one mutator the chats files do not provide.
function addChat(data: MockData, entry: ChatEntry): void {
  (data as { chats: readonly ChatEntry[] }).chats = [...data.chats, entry];
}

function chatEntryOf(row: MockGroupInfo): GroupChatEntry {
  const memberCount = row.memberCount + 1;
  return {
    kind: 'group',
    chatJid: row.chatJid,
    title: row.title,
    groupId: row.id,
    memberCount,
    role: 'member',
    visibility: row.visibility,
    handle: row.handle,
    description: row.description,
    ...(row.kind === 'channel'
      ? { chatKind: 'channel' as const, subscriberCount: memberCount }
      : {}),
  };
}
