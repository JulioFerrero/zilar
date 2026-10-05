import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { chatFolderSeeds, chatFolders } from '../db/schema';
import { HttpError } from '../errors';

// Mirrors `packages/chat-core/src/folders.ts` (FOLDER_ICONS,
// FOLDER_NAME_MAX, FOLDERS_MAX, FOLDER_CHATS_MAX). The server does not
// depend on `@zilar/chat-core`, so the list and limits are copied here.
export const FOLDER_ICONS = [
  'folder',
  'message-circle',
  'user',
  'users',
  'megaphone',
  'bot',
  'briefcase',
  'house',
  'star',
  'heart',
  'bookmark',
  'flag',
  'bell',
  'globe',
  'graduation-cap',
  'gamepad-2',
  'music',
  'camera',
  'shopping-bag',
  'plane',
  'coffee',
  'dumbbell',
  'code',
  'wallet',
] as const;

export type FolderIcon = (typeof FOLDER_ICONS)[number];

export const FOLDER_CHAT_TYPES = ['dm', 'group', 'channel', 'ai'] as const;

export type FolderChatType = (typeof FOLDER_CHAT_TYPES)[number];

export const FOLDER_NAME_MAX = 24;
export const FOLDERS_MAX = 20;
export const FOLDER_CHATS_MAX = 100;

export type ChatFolderRow = typeof chatFolders.$inferSelect;

export interface ChatFolderView {
  id: string;
  name: string;
  icon: FolderIcon;
  position: number;
  includeTypes: FolderChatType[];
  includeChats: string[];
  excludeChats: string[];
  excludeMuted: boolean;
  excludeRead: boolean;
}

export function toChatFolderView(row: ChatFolderRow): ChatFolderView {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon as FolderIcon,
    position: row.position,
    includeTypes: [...row.includeTypes] as FolderChatType[],
    includeChats: [...row.includeChats],
    excludeChats: [...row.excludeChats],
    excludeMuted: row.excludeMuted,
    excludeRead: row.excludeRead,
  };
}

function sortByPosition(rows: ChatFolderRow[]): ChatFolderRow[] {
  return [...rows].sort(
    (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

interface DefaultFolderSeed {
  name: string;
  icon: FolderIcon;
  includeTypes: FolderChatType[];
}

const DEFAULT_FOLDER_SEEDS: DefaultFolderSeed[] = [
  { name: 'Personal', icon: 'user', includeTypes: ['dm'] },
  { name: 'AIs', icon: 'bot', includeTypes: ['ai'] },
];

type FolderTransaction = Parameters<Parameters<ServerDatabase['transaction']>[0]>[0];

// Seeds the two defaults (Personal and AIs) the first time a user lists
// folders. Runs in the caller's transaction under a per-user advisory lock
// and re-reads state inside it, so concurrent first lists seed once: the
// seed row insert is the race backstop (the loser sees the winner's rows).
async function ensureSeeded(
  tx: FolderTransaction,
  userId: string,
  now: Date,
): Promise<ChatFolderRow[]> {
  const existing = await tx.select().from(chatFolders).where(eq(chatFolders.userId, userId));
  const [seed] = await tx
    .select()
    .from(chatFolderSeeds)
    .where(eq(chatFolderSeeds.userId, userId))
    .limit(1);
  if (seed !== undefined || existing.length > 0) {
    return sortByPosition(existing);
  }
  await tx.insert(chatFolderSeeds).values({ userId, seededAt: now }).onConflictDoNothing();
  const current = await tx.select().from(chatFolders).where(eq(chatFolders.userId, userId));
  if (current.length > 0) {
    return sortByPosition(current);
  }
  const rows = await tx
    .insert(chatFolders)
    .values(
      DEFAULT_FOLDER_SEEDS.map((folder, index) => ({
        id: randomUUID(),
        userId,
        name: folder.name,
        icon: folder.icon,
        position: index,
        includeTypes: [...folder.includeTypes],
        includeChats: [],
        excludeChats: [],
        excludeMuted: false,
        excludeRead: false,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning();
  return sortByPosition(rows);
}

export async function listChatFolders(
  db: ServerDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<ChatFolderView[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + userId}))`);
    return ensureSeeded(tx, userId, now);
  });
  return rows.map(toChatFolderView);
}

export interface CreateChatFolderInput {
  userId: string;
  name: string;
  icon: FolderIcon;
  includeTypes: FolderChatType[];
  includeChats: string[];
  excludeChats: string[];
  excludeMuted: boolean;
  excludeRead: boolean;
  now: Date;
}

export async function createChatFolder(
  db: ServerDatabase,
  input: CreateChatFolderInput,
): Promise<ChatFolderView> {
  const created = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + input.userId}))`,
    );
    const current = await tx.select().from(chatFolders).where(eq(chatFolders.userId, input.userId));
    if (current.length >= FOLDERS_MAX) {
      throw new HttpError(409, 'folder_limit', 'You can have up to 20 folders.');
    }
    const position = current.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const [row] = await tx
      .insert(chatFolders)
      .values({
        id: randomUUID(),
        userId: input.userId,
        name: input.name,
        icon: input.icon,
        position,
        includeTypes: [...input.includeTypes],
        includeChats: [...input.includeChats],
        excludeChats: [...input.excludeChats],
        excludeMuted: input.excludeMuted,
        excludeRead: input.excludeRead,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    if (!row) {
      throw new HttpError(500, 'internal_error', 'Could not create the folder');
    }
    return row;
  });
  return toChatFolderView(created);
}

export interface UpdateChatFolderInput {
  userId: string;
  id: string;
  name?: string | undefined;
  icon?: FolderIcon | undefined;
  includeTypes?: FolderChatType[] | undefined;
  includeChats?: string[] | undefined;
  excludeChats?: string[] | undefined;
  excludeMuted?: boolean | undefined;
  excludeRead?: boolean | undefined;
  now: Date;
}

/**
 * Partial update of one of the caller's folders. An id that is unknown or
 * belongs to another user answers the same 404, so ids cannot be probed.
 */
export async function updateChatFolder(
  db: ServerDatabase,
  input: UpdateChatFolderInput,
): Promise<ChatFolderView> {
  const updated = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + input.userId}))`,
    );
    const [existing] = await tx
      .select()
      .from(chatFolders)
      .where(and(eq(chatFolders.userId, input.userId), eq(chatFolders.id, input.id)))
      .limit(1);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Folder not found');
    }
    const [row] = await tx
      .update(chatFolders)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.includeTypes !== undefined ? { includeTypes: [...input.includeTypes] } : {}),
        ...(input.includeChats !== undefined ? { includeChats: [...input.includeChats] } : {}),
        ...(input.excludeChats !== undefined ? { excludeChats: [...input.excludeChats] } : {}),
        ...(input.excludeMuted !== undefined ? { excludeMuted: input.excludeMuted } : {}),
        ...(input.excludeRead !== undefined ? { excludeRead: input.excludeRead } : {}),
        updatedAt: input.now,
      })
      .where(and(eq(chatFolders.userId, input.userId), eq(chatFolders.id, input.id)))
      .returning();
    if (!row) {
      throw new HttpError(500, 'internal_error', 'Could not update the folder');
    }
    return row;
  });
  return toChatFolderView(updated);
}

/**
 * Rewrites positions 0..n-1 in the order of `ids`. The ids must be exactly
 * the caller's folder ids: no missing, no extra, no duplicates.
 */
export async function reorderChatFolders(
  db: ServerDatabase,
  options: { userId: string; ids: string[]; now: Date },
): Promise<ChatFolderView[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + options.userId}))`,
    );
    const current = await tx
      .select()
      .from(chatFolders)
      .where(eq(chatFolders.userId, options.userId));
    const currentIds = new Set(current.map((row) => row.id));
    if (
      options.ids.length !== current.length ||
      new Set(options.ids).size !== options.ids.length ||
      options.ids.some((id) => !currentIds.has(id))
    ) {
      throw new HttpError(
        400,
        'invalid_request',
        'Folder order must list every folder exactly once',
      );
    }
    for (const [position, id] of options.ids.entries()) {
      await tx
        .update(chatFolders)
        .set({ position, updatedAt: options.now })
        .where(and(eq(chatFolders.userId, options.userId), eq(chatFolders.id, id)));
    }
    return tx.select().from(chatFolders).where(eq(chatFolders.userId, options.userId));
  });
  return sortByPosition(rows).map(toChatFolderView);
}

export async function deleteChatFolder(
  db: ServerDatabase,
  options: { userId: string; id: string },
): Promise<ChatFolderView[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + options.userId}))`,
    );
    const [existing] = await tx
      .select()
      .from(chatFolders)
      .where(and(eq(chatFolders.userId, options.userId), eq(chatFolders.id, options.id)))
      .limit(1);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Folder not found');
    }
    await tx
      .delete(chatFolders)
      .where(and(eq(chatFolders.userId, options.userId), eq(chatFolders.id, options.id)));
    const rest = await tx.select().from(chatFolders).where(eq(chatFolders.userId, options.userId));
    const ordered = sortByPosition(rest);
    for (const [position, row] of ordered.entries()) {
      if (row.position !== position) {
        await tx
          .update(chatFolders)
          .set({ position })
          .where(and(eq(chatFolders.userId, options.userId), eq(chatFolders.id, row.id)));
      }
    }
    return tx.select().from(chatFolders).where(eq(chatFolders.userId, options.userId));
  });
  return sortByPosition(rows).map(toChatFolderView);
}
