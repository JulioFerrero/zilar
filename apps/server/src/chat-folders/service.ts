import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import {
  CreateChatFolderPayload,
  PatchChatFolderPayload,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/api-contract';
import type { ServerDatabase } from '../db/client';
import type { ChatFolderRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
export const FOLDERS_MAX = 20;
type CreateInput = { userId: string; now: Date } & typeof CreateChatFolderPayload.Type;
type UpdateInput = { userId: string; id: string; now: Date } & typeof PatchChatFolderPayload.Type;
function toChatFolderView({
  userId: _userId,
  createdAt: _createdAt,
  updatedAt: _updatedAt,
  ...row
}: ChatFolderRow): ChatFolder {
  return {
    ...row,
    icon: row.icon as FolderIcon,
    includeTypes: row.includeTypes as FolderChatType[],
  };
}
const sortByPosition = (rows: ChatFolderRow[]): ChatFolderRow[] =>
  [...rows].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const textArray = (sql: SqlClient.SqlClient, values: ReadonlyArray<string>) =>
  sql`ARRAY[${sql.join(',', false)(values.map((value) => sql`${value}`))}]::text[]`;
function ensureSeeded(
  sql: SqlClient.SqlClient,
  userId: string,
  now: Date,
): Effect.Effect<ChatFolderRow[], SqlError.SqlError> {
  return Effect.gen(function* () {
    const existing =
      yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${userId}`;
    const [seed] = yield* sql<{
      userId: string;
    }>`SELECT * FROM chat_folder_seeds WHERE user_id = ${userId} LIMIT 1`;
    if (seed !== undefined || existing.length > 0) return sortByPosition([...existing]);
    yield* sql`INSERT INTO chat_folder_seeds (user_id, seeded_at) VALUES (${userId}, ${now.toISOString()}) ON CONFLICT DO NOTHING`;
    const rows =
      yield* sql<ChatFolderRow>`INSERT INTO chat_folders (id, user_id, name, icon, position, include_types, include_chats, exclude_chats, exclude_muted, exclude_read, created_at, updated_at) VALUES (${randomUUID()}, ${userId}, 'Personal', 'user', 0, ARRAY['dm']::text[], ARRAY[]::text[], ARRAY[]::text[], false, false, ${now.toISOString()}, ${now.toISOString()}), (${randomUUID()}, ${userId}, 'AIs', 'bot', 1, ARRAY['ai']::text[], ARRAY[]::text[], ARRAY[]::text[], false, false, ${now.toISOString()}, ${now.toISOString()}) RETURNING *`;
    return sortByPosition([...rows]);
  });
}
function folderTransaction<A>(
  db: ServerDatabase,
  userId: string,
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, HttpError | SqlError.SqlError>,
): Promise<A> {
  return runSql(
    db,
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.flatMap(
          sql`SELECT pg_advisory_xact_lock(hashtext(${'chat-folders:' + userId}))`,
          () => run(sql),
        ),
      ),
    ),
  );
}
export async function listChatFolders(
  db: ServerDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<ChatFolder[]> {
  const rows = await folderTransaction(db, userId, (sql) => ensureSeeded(sql, userId, now));
  return rows.map(toChatFolderView);
}
export async function createChatFolder(
  db: ServerDatabase,
  input: CreateInput,
): Promise<ChatFolder> {
  const created = await folderTransaction(db, input.userId, (sql) =>
    Effect.gen(function* () {
      const current =
        yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${input.userId}`;
      if (current.length >= FOLDERS_MAX) {
        return yield* Effect.fail(
          new HttpError(409, 'folder_limit', 'You can have up to 20 folders.'),
        );
      }
      const position = current.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      const [row] =
        yield* sql<ChatFolderRow>`INSERT INTO chat_folders (id, user_id, name, icon, position, include_types, include_chats, exclude_chats, exclude_muted, exclude_read, created_at, updated_at) VALUES (${randomUUID()}, ${input.userId}, ${input.name}, ${input.icon}, ${position}, ${textArray(sql, input.includeTypes ?? [])}, ${textArray(sql, input.includeChats ?? [])}, ${textArray(sql, input.excludeChats ?? [])}, ${input.excludeMuted ?? false}, ${input.excludeRead ?? false}, ${input.now.toISOString()}, ${input.now.toISOString()}) RETURNING *`;
      if (!row) throw new HttpError(500, 'internal_error', 'Could not create the folder');
      return row;
    }),
  );
  return toChatFolderView(created);
}
export async function updateChatFolder(
  db: ServerDatabase,
  input: UpdateInput,
): Promise<ChatFolder> {
  const updated = await folderTransaction(db, input.userId, (sql) =>
    Effect.gen(function* () {
      const [existing] =
        yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${input.userId} AND id = ${input.id} LIMIT 1`;
      if (!existing) return yield* Effect.fail(new HttpError(404, 'not_found', 'Folder not found'));
      const sets = [sql`updated_at = ${input.now.toISOString()}`];
      if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
      if (input.icon !== undefined) sets.push(sql`icon = ${input.icon}`);
      if (input.includeTypes !== undefined)
        sets.push(sql`include_types = ${textArray(sql, input.includeTypes)}`);
      if (input.includeChats !== undefined)
        sets.push(sql`include_chats = ${textArray(sql, input.includeChats)}`);
      if (input.excludeChats !== undefined)
        sets.push(sql`exclude_chats = ${textArray(sql, input.excludeChats)}`);
      if (input.excludeMuted !== undefined) sets.push(sql`exclude_muted = ${input.excludeMuted}`);
      if (input.excludeRead !== undefined) sets.push(sql`exclude_read = ${input.excludeRead}`);
      const set = sql.join(', ', false)(sets);
      const [row] =
        yield* sql<ChatFolderRow>`UPDATE chat_folders SET ${set} WHERE user_id = ${input.userId} AND id = ${input.id} RETURNING *`;
      if (!row) throw new HttpError(500, 'internal_error', 'Could not update the folder');
      return row;
    }),
  );
  return toChatFolderView(updated);
}
export async function reorderChatFolders(
  db: ServerDatabase,
  options: { userId: string; ids: string[]; now: Date },
): Promise<ChatFolder[]> {
  const rows = await folderTransaction(db, options.userId, (sql) =>
    Effect.gen(function* () {
      const current =
        yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${options.userId}`;
      const currentIds = new Set(current.map((row) => row.id));
      if (
        options.ids.length !== current.length ||
        new Set(options.ids).size !== options.ids.length ||
        options.ids.some((id) => !currentIds.has(id))
      ) {
        return yield* Effect.fail(
          new HttpError(400, 'invalid_request', 'Folder order must list every folder exactly once'),
        );
      }
      for (const [position, id] of options.ids.entries()) {
        yield* sql`UPDATE chat_folders SET position = ${position}, updated_at = ${options.now.toISOString()} WHERE user_id = ${options.userId} AND id = ${id}`;
      }
      return yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${options.userId}`;
    }),
  );
  return sortByPosition([...rows]).map(toChatFolderView);
}
export async function deleteChatFolder(
  db: ServerDatabase,
  options: { userId: string; id: string },
): Promise<ChatFolder[]> {
  const rows = await folderTransaction(db, options.userId, (sql) =>
    Effect.gen(function* () {
      const [existing] =
        yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${options.userId} AND id = ${options.id} LIMIT 1`;
      if (!existing) return yield* Effect.fail(new HttpError(404, 'not_found', 'Folder not found'));
      yield* sql`DELETE FROM chat_folders WHERE user_id = ${options.userId} AND id = ${options.id}`;
      const rest = sortByPosition([
        ...(yield* sql<ChatFolderRow>`SELECT * FROM chat_folders WHERE user_id = ${options.userId}`),
      ]);
      for (const [position, row] of rest.entries()) {
        if (row.position !== position) {
          yield* sql`UPDATE chat_folders SET position = ${position} WHERE user_id = ${options.userId} AND id = ${row.id}`;
          row.position = position;
        }
      }
      return rest;
    }),
  );
  return rows.map(toChatFolderView);
}
