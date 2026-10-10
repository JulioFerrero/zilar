// Telegram-style chat folders (T-0232). Every query runs on the `effect/sql`
// client registered for this database (see `../effect/sql`); the exported
// functions stay `async` so routes and tests keep their shape during the
// transition.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { FolderChatType, FolderIcon } from '@zilar/api-contract';
import type { ServerDatabase } from '../db/client';
import type { ChatFolderRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';

// The icon list, chat types and the name and chat-list limits live in the
// shared contract (T-0892; they mirror `packages/chat-core/src/folders.ts`).
export {
  FOLDER_CHATS_MAX,
  FOLDER_CHAT_TYPES,
  FOLDER_ICONS,
  FOLDER_NAME_MAX,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/api-contract';

export const FOLDERS_MAX = 20;

export type { ChatFolderRow };

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

// A one-dimensional `text[]` value built from scalar placeholders. The
// effect/sql pg driver cannot infer the type of an empty JS array, so every
// array column is written through the `ARRAY[...]::text[]` constructor: an
// empty list is `ARRAY[]::text[]`, and both drivers bind only strings.
function textArray(sql: SqlClient.SqlClient, values: ReadonlyArray<string>) {
  return sql`ARRAY[${sql.join(',', false)(values.map((value) => sql`${value}`))}]::text[]`;
}

// Seeds the two defaults (Personal and AIs) the first time a user lists
// folders. Runs in the caller's transaction under a per-user advisory lock
// and re-reads state inside it, so concurrent first lists seed once: the
// seed row insert is the race backstop (the loser sees the winner's rows).
function ensureSeeded(
  sql: SqlClient.SqlClient,
  userId: string,
  now: Date,
): Effect.Effect<ChatFolderRow[], SqlError.SqlError> {
  return Effect.gen(function* () {
    const existing = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
      WHERE user_id = ${userId}`;
    const [seed] = yield* sql<{ userId: string }>`SELECT * FROM chat_folder_seeds
      WHERE user_id = ${userId} LIMIT 1`;
    if (seed !== undefined || existing.length > 0) {
      return sortByPosition([...existing]);
    }
    yield* sql`INSERT INTO chat_folder_seeds (user_id, seeded_at)
      VALUES (${userId}, ${now.toISOString()}) ON CONFLICT DO NOTHING`;
    const current = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
      WHERE user_id = ${userId}`;
    if (current.length > 0) {
      return sortByPosition([...current]);
    }
    const values = sql.join(
      ',',
      false,
    )(
      DEFAULT_FOLDER_SEEDS.map(
        (folder, index) =>
          sql`(${randomUUID()}, ${userId}, ${folder.name}, ${folder.icon}, ${index}, ${textArray(sql, folder.includeTypes)}, ${textArray(sql, [])}, ${textArray(sql, [])}, ${false}, ${false}, ${now.toISOString()}, ${now.toISOString()})`,
      ),
    );
    const rows = yield* sql<ChatFolderRow>`INSERT INTO chat_folders
        (id, user_id, name, icon, position, include_types, include_chats,
          exclude_chats, exclude_muted, exclude_read, created_at, updated_at)
      VALUES ${values}
      RETURNING *`;
    return sortByPosition([...rows]);
  });
}

export async function listChatFolders(
  db: ServerDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<ChatFolderView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + userId}))`;
          return yield* ensureSeeded(sql, userId, now);
        }),
      );
    }),
  );
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
  const created = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + input.userId}))`;
          const current = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${input.userId}`;
          if (current.length >= FOLDERS_MAX) {
            return yield* Effect.fail(
              new HttpError(409, 'folder_limit', 'You can have up to 20 folders.'),
            );
          }
          const position = current.reduce((max, row) => Math.max(max, row.position), -1) + 1;
          const [row] = yield* sql<ChatFolderRow>`INSERT INTO chat_folders
              (id, user_id, name, icon, position, include_types, include_chats,
                exclude_chats, exclude_muted, exclude_read, created_at, updated_at)
            VALUES (
              ${randomUUID()},
              ${input.userId},
              ${input.name},
              ${input.icon},
              ${position},
              ${textArray(sql, input.includeTypes)},
              ${textArray(sql, input.includeChats)},
              ${textArray(sql, input.excludeChats)},
              ${input.excludeMuted},
              ${input.excludeRead},
              ${input.now.toISOString()},
              ${input.now.toISOString()}
            )
            RETURNING *`;
          if (!row) {
            return yield* Effect.fail(
              new HttpError(500, 'internal_error', 'Could not create the folder'),
            );
          }
          return row;
        }),
      );
    }),
  );
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
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + input.userId}))`;
          const [existing] = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${input.userId} AND id = ${input.id} LIMIT 1`;
          if (!existing) {
            return yield* Effect.fail(new HttpError(404, 'not_found', 'Folder not found'));
          }
          const set = sql.join(
            ', ',
            false,
          )([
            ...(input.name !== undefined ? [sql`name = ${input.name}`] : []),
            ...(input.icon !== undefined ? [sql`icon = ${input.icon}`] : []),
            ...(input.includeTypes !== undefined
              ? [sql`include_types = ${textArray(sql, input.includeTypes)}`]
              : []),
            ...(input.includeChats !== undefined
              ? [sql`include_chats = ${textArray(sql, input.includeChats)}`]
              : []),
            ...(input.excludeChats !== undefined
              ? [sql`exclude_chats = ${textArray(sql, input.excludeChats)}`]
              : []),
            ...(input.excludeMuted !== undefined
              ? [sql`exclude_muted = ${input.excludeMuted}`]
              : []),
            ...(input.excludeRead !== undefined ? [sql`exclude_read = ${input.excludeRead}`] : []),
            sql`updated_at = ${input.now.toISOString()}`,
          ]);
          const [row] = yield* sql<ChatFolderRow>`UPDATE chat_folders SET ${set}
            WHERE user_id = ${input.userId} AND id = ${input.id}
            RETURNING *`;
          if (!row) {
            return yield* Effect.fail(
              new HttpError(500, 'internal_error', 'Could not update the folder'),
            );
          }
          return row;
        }),
      );
    }),
  );
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
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + options.userId}))`;
          const current = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${options.userId}`;
          const currentIds = new Set(current.map((row) => row.id));
          if (
            options.ids.length !== current.length ||
            new Set(options.ids).size !== options.ids.length ||
            options.ids.some((id) => !currentIds.has(id))
          ) {
            return yield* Effect.fail(
              new HttpError(
                400,
                'invalid_request',
                'Folder order must list every folder exactly once',
              ),
            );
          }
          for (const [position, id] of options.ids.entries()) {
            yield* sql`UPDATE chat_folders SET position = ${position},
                updated_at = ${options.now.toISOString()}
              WHERE user_id = ${options.userId} AND id = ${id}`;
          }
          return yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${options.userId}`;
        }),
      );
    }),
  );
  return sortByPosition([...rows]).map(toChatFolderView);
}

export async function deleteChatFolder(
  db: ServerDatabase,
  options: { userId: string; id: string },
): Promise<ChatFolderView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + options.userId}))`;
          const [existing] = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${options.userId} AND id = ${options.id} LIMIT 1`;
          if (!existing) {
            return yield* Effect.fail(new HttpError(404, 'not_found', 'Folder not found'));
          }
          yield* sql`DELETE FROM chat_folders
            WHERE user_id = ${options.userId} AND id = ${options.id}`;
          const rest = yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${options.userId}`;
          const ordered = sortByPosition([...rest]);
          for (const [position, row] of ordered.entries()) {
            if (row.position !== position) {
              yield* sql`UPDATE chat_folders SET position = ${position}
                WHERE user_id = ${options.userId} AND id = ${row.id}`;
            }
          }
          return yield* sql<ChatFolderRow>`SELECT * FROM chat_folders
            WHERE user_id = ${options.userId}`;
        }),
      );
    }),
  );
  return sortByPosition([...rows]).map(toChatFolderView);
}
