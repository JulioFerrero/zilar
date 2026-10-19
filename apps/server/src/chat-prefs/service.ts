import { Effect } from 'effect';
import { PutChatPrefPayload, type ChatPref } from '@zilar/api-contract';
import { SqlClient, type SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { ChatPrefRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { BackgroundFieldsInput, GroupBackground } from '../groups/schemas';
export const CHAT_PREFS_MAX_ROWS = 200,
  CHAT_PREFS_MAX_PINNED = 20;
export type ChatPrefView = ChatPref;
const EMPTY_BACKGROUND = { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };
function pick<T>(next: T | undefined, current: T | null | undefined, fallback: T): T {
  return next === undefined ? (current ?? fallback) : next;
}
function toChatPrefView({ userId: _userId, ...row }: ChatPrefRow): ChatPrefView {
  return {
    ...row,
    mutedUntil: row.mutedUntil?.toISOString() ?? null,
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function query<A, E>(
  db: ServerDatabase,
  build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
): Promise<A> {
  return runSql(db, Effect.flatMap(SqlClient.SqlClient, build));
}
export async function listChatPrefs(db: ServerDatabase, userId: string): Promise<ChatPrefView[]> {
  const rows = await query(
    db,
    (sql) => sql<ChatPrefRow>`SELECT * FROM chat_prefs WHERE user_id = ${userId}`,
  );
  return rows.map(toChatPrefView).sort((a, b) => a.chatJid.localeCompare(b.chatJid));
}
export type PutChatPrefInput = {
  userId: string;
  bare: string;
  now: Date;
  mutedUntil?: Date | null | undefined;
} & Omit<typeof PutChatPrefPayload.Type, 'mutedUntil'>;
export function putChatPref(
  db: ServerDatabase,
  input: PutChatPrefInput,
): Promise<ChatPrefView | null> {
  return runSql(
    db,
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`chat-prefs:${input.userId}`}))`;
          const [existing] =
            yield* sql<ChatPrefRow>`SELECT * FROM chat_prefs WHERE user_id = ${input.userId} AND chat_jid = ${input.bare} LIMIT 1`;
          const mutedUntil = pick(input.mutedUntil, existing?.mutedUntil, null);
          const archived = pick(input.archived, existing?.archived, false);
          const pinnedAt =
            input.pinned === undefined
              ? (existing?.pinnedAt ?? null)
              : input.pinned
                ? (existing?.pinnedAt ?? input.now)
                : null;
          const unreadMark = pick(input.unreadMark, existing?.unreadMark, false);
          const background = yield* resolveBackgroundFields(sql, input.userId, existing, input);
          const defaults =
            mutedUntil === null &&
            !archived &&
            pinnedAt === null &&
            !unreadMark &&
            Object.values(background).every((value) => value === null);
          if (defaults) {
            if (existing !== undefined) {
              yield* sql`DELETE FROM chat_prefs WHERE user_id = ${input.userId} AND chat_jid = ${input.bare}`;
            }
            return null;
          }
          const [counts] = yield* sql<{
            total: number;
            pinned: number;
          }>`SELECT count(*)::int AS total, count(*) FILTER (WHERE pinned_at IS NOT NULL)::int AS pinned FROM chat_prefs WHERE user_id = ${input.userId}`;
          if (existing === undefined && (counts?.total ?? 0) >= CHAT_PREFS_MAX_ROWS) {
            return yield* Effect.fail(
              new HttpError(409, 'too_many_prefs', 'Too many chat preferences'),
            );
          }
          if (
            pinnedAt !== null &&
            (existing === undefined || existing.pinnedAt === null) &&
            (counts?.pinned ?? 0) >= CHAT_PREFS_MAX_PINNED
          ) {
            return yield* Effect.fail(new HttpError(409, 'too_many_pins', 'Too many pinned chats'));
          }
          const [row] =
            yield* sql<ChatPrefRow>`INSERT INTO chat_prefs (user_id, chat_jid, muted_until, archived, pinned_at, unread_mark, background_preset, background_image_id, background_dim, updated_at) VALUES (${input.userId}, ${input.bare}, ${mutedUntil === null ? null : mutedUntil.toISOString()}, ${archived}, ${pinnedAt === null ? null : pinnedAt.toISOString()}, ${unreadMark}, ${background.backgroundPreset}, ${background.backgroundImageId}, ${background.backgroundDim}, ${input.now.toISOString()}) ON CONFLICT (user_id, chat_jid) DO UPDATE SET muted_until = EXCLUDED.muted_until, archived = EXCLUDED.archived, pinned_at = EXCLUDED.pinned_at, unread_mark = EXCLUDED.unread_mark, background_preset = EXCLUDED.background_preset, background_image_id = EXCLUDED.background_image_id, background_dim = EXCLUDED.background_dim, updated_at = EXCLUDED.updated_at RETURNING *`;
          if (!row)
            throw new HttpError(500, 'internal_error', 'Could not save the chat preference');
          return toChatPrefView(row);
        }),
      ),
    ),
  );
}
function resolveBackgroundFields(
  sql: SqlClient.SqlClient,
  userId: string,
  existing: GroupBackground | undefined,
  input: BackgroundFieldsInput,
): Effect.Effect<GroupBackground, HttpError | SqlError.SqlError> {
  return Effect.gen(function* () {
    const backgroundPreset = pick(input.backgroundPreset, existing?.backgroundPreset, null);
    const backgroundImageId = pick(input.backgroundImageId, existing?.backgroundImageId, null);
    const backgroundDim = pick(input.backgroundDim, existing?.backgroundDim, null);
    if (backgroundPreset !== null && backgroundImageId !== null) {
      return yield* Effect.fail(
        new HttpError(400, 'invalid_request', 'Choose a preset or an image'),
      );
    }
    if (backgroundDim !== null && backgroundImageId === null) {
      return yield* Effect.fail(new HttpError(400, 'invalid_request', 'Dim needs an image'));
    }
    if (backgroundImageId !== null) {
      const [image] = yield* sql<{
        id: string;
      }>`SELECT id FROM chat_backgrounds WHERE id = ${backgroundImageId} AND user_id = ${userId} LIMIT 1`;
      if (image === undefined) {
        return yield* Effect.fail(
          new HttpError(400, 'invalid_request', 'Unknown background image'),
        );
      }
    }
    return { backgroundPreset, backgroundImageId, backgroundDim };
  });
}
export async function getChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
): Promise<GroupBackground> {
  const [row] = await query(
    db,
    (sql) =>
      sql<GroupBackground>`SELECT background_preset, background_image_id, background_dim FROM chat_background_defaults WHERE user_id = ${userId} LIMIT 1`,
  );
  return row ?? EMPTY_BACKGROUND;
}
export async function putChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
  input: BackgroundFieldsInput & { now: Date },
): Promise<GroupBackground> {
  const [existing] = await query(
    db,
    (sql) =>
      sql<GroupBackground>`SELECT * FROM chat_background_defaults WHERE user_id = ${userId} LIMIT 1`,
  );
  const background = await query(db, (sql) =>
    resolveBackgroundFields(sql, userId, existing, input),
  );
  if (Object.values(background).every((value) => value === null)) {
    await query(db, (sql) => sql`DELETE FROM chat_background_defaults WHERE user_id = ${userId}`);
    return EMPTY_BACKGROUND;
  }
  const [row] = await query(
    db,
    (sql) =>
      sql<GroupBackground>`INSERT INTO chat_background_defaults (user_id, background_preset, background_image_id, background_dim, updated_at) VALUES (${userId}, ${background.backgroundPreset}, ${background.backgroundImageId}, ${background.backgroundDim}, ${input.now.toISOString()}) ON CONFLICT (user_id) DO UPDATE SET background_preset = EXCLUDED.background_preset, background_image_id = EXCLUDED.background_image_id, background_dim = EXCLUDED.background_dim, updated_at = EXCLUDED.updated_at RETURNING background_preset, background_image_id, background_dim`,
  );
  return row ?? EMPTY_BACKGROUND;
}
