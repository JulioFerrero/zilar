import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { ChatPrefRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { BackgroundFieldsInput, GroupBackground } from '../groups/schemas';

export const CHAT_PREFS_MAX_ROWS = 200;
export const CHAT_PREFS_MAX_PINNED = 20;

export type { ChatPrefRow };

export interface ChatPrefView extends GroupBackground {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  unreadMark: boolean;
  updatedAt: string;
}

export function toChatPrefView(row: ChatPrefRow): ChatPrefView {
  return {
    chatJid: row.chatJid,
    mutedUntil: row.mutedUntil === null ? null : row.mutedUntil.toISOString(),
    archived: row.archived,
    pinnedAt: row.pinnedAt === null ? null : row.pinnedAt.toISOString(),
    unreadMark: row.unreadMark,
    backgroundPreset: row.backgroundPreset,
    backgroundImageId: row.backgroundImageId,
    backgroundDim: row.backgroundDim,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listChatPrefs(db: ServerDatabase, userId: string): Promise<ChatPrefView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatPrefRow>`SELECT * FROM chat_prefs WHERE user_id = ${userId}`;
    }),
  );
  return rows.map(toChatPrefView).sort((a, b) => a.chatJid.localeCompare(b.chatJid));
}

export interface PutChatPrefInput extends BackgroundFieldsInput {
  userId: string;
  bare: string;
  /** `undefined` leaves the field; `null` clears it. */
  mutedUntil?: Date | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  /** `undefined` leaves the unread mark; true/false sets it. */
  unreadMark?: boolean | undefined;
  now: Date;
}

/**
 * A write back on all defaults deletes the row, and the per-user row and pin caps are
 * enforced. `pinned: true` stamps `now` (keeping an existing stamp).
 */
export async function putChatPref(
  db: ServerDatabase,
  input: PutChatPrefInput,
): Promise<ChatPrefView | null> {
  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatPrefRow>`SELECT * FROM chat_prefs
        WHERE user_id = ${input.userId} AND chat_jid = ${input.bare} LIMIT 1`;
    }),
  );

  const mutedUntil =
    input.mutedUntil === undefined ? (existing?.mutedUntil ?? null) : input.mutedUntil;
  const archived = input.archived === undefined ? (existing?.archived ?? false) : input.archived;
  const pinnedAt =
    input.pinned === undefined
      ? (existing?.pinnedAt ?? null)
      : input.pinned
        ? (existing?.pinnedAt ?? input.now)
        : null;
  const unreadMark =
    input.unreadMark === undefined ? (existing?.unreadMark ?? false) : input.unreadMark;
  const background = await resolveBackgroundFields(db, input.userId, existing, input);

  if (
    mutedUntil === null &&
    archived === false &&
    pinnedAt === null &&
    unreadMark === false &&
    background.backgroundPreset === null &&
    background.backgroundImageId === null &&
    background.backgroundDim === null
  ) {
    if (existing !== undefined) {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM chat_prefs
            WHERE user_id = ${input.userId} AND chat_jid = ${input.bare}`;
        }),
      );
    }
    return null;
  }

  if (existing === undefined) {
    const [total] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM chat_prefs
          WHERE user_id = ${input.userId}`;
      }),
    );
    if (Number(total?.total ?? 0) >= CHAT_PREFS_MAX_ROWS) {
      throw new HttpError(409, 'too_many_prefs', 'Too many chat preferences');
    }
  }
  if (pinnedAt !== null && (existing === undefined || existing.pinnedAt === null)) {
    const [pinned] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM chat_prefs
          WHERE user_id = ${input.userId} AND pinned_at IS NOT NULL`;
      }),
    );
    if (Number(pinned?.total ?? 0) >= CHAT_PREFS_MAX_PINNED) {
      throw new HttpError(409, 'too_many_pins', 'Too many pinned chats');
    }
  }

  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatPrefRow>`INSERT INTO chat_prefs
          (user_id, chat_jid, muted_until, archived, pinned_at, unread_mark,
            background_preset, background_image_id, background_dim, updated_at)
        VALUES (
          ${input.userId},
          ${input.bare},
          ${mutedUntil === null ? null : mutedUntil.toISOString()},
          ${archived},
          ${pinnedAt === null ? null : pinnedAt.toISOString()},
          ${unreadMark},
          ${background.backgroundPreset},
          ${background.backgroundImageId},
          ${background.backgroundDim},
          ${input.now.toISOString()}
        )
        ON CONFLICT (user_id, chat_jid) DO UPDATE SET
          muted_until = EXCLUDED.muted_until,
          archived = EXCLUDED.archived,
          pinned_at = EXCLUDED.pinned_at,
          unread_mark = EXCLUDED.unread_mark,
          background_preset = EXCLUDED.background_preset,
          background_image_id = EXCLUDED.background_image_id,
          background_dim = EXCLUDED.background_dim,
          updated_at = EXCLUDED.updated_at
        RETURNING *`;
    }),
  );
  if (!row) {
    throw new HttpError(500, 'internal_error', 'Could not save the chat preference');
  }
  return toChatPrefView(row);
}
// An image id that does not exist and one owned by another user answer the same error,
// so ids cannot be probed.
async function resolveBackgroundFields(
  db: ServerDatabase,
  userId: string,
  existing: GroupBackground | undefined,
  input: BackgroundFieldsInput,
): Promise<GroupBackground> {
  const backgroundPreset =
    input.backgroundPreset === undefined
      ? (existing?.backgroundPreset ?? null)
      : input.backgroundPreset;
  const backgroundImageId =
    input.backgroundImageId === undefined
      ? (existing?.backgroundImageId ?? null)
      : input.backgroundImageId;
  const backgroundDim =
    input.backgroundDim === undefined ? (existing?.backgroundDim ?? null) : input.backgroundDim;

  if (backgroundPreset !== null && backgroundImageId !== null) {
    throw new HttpError(400, 'invalid_request', 'Choose a preset or an image');
  }
  if (backgroundDim !== null && backgroundImageId === null) {
    throw new HttpError(400, 'invalid_request', 'Dim needs an image');
  }
  if (backgroundImageId !== null) {
    const [image] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM chat_backgrounds
          WHERE id = ${backgroundImageId} AND user_id = ${userId} LIMIT 1`;
      }),
    );
    if (image === undefined) {
      throw new HttpError(400, 'invalid_request', 'Unknown background image');
    }
  }
  return { backgroundPreset, backgroundImageId, backgroundDim };
}

interface PutChatBackgroundDefaultInput extends BackgroundFieldsInput {
  now: Date;
}

export async function getChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
): Promise<GroupBackground> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupBackground>`SELECT background_preset, background_image_id, background_dim
        FROM chat_background_defaults WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };
}

export async function putChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
  input: PutChatBackgroundDefaultInput,
): Promise<GroupBackground> {
  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupBackground>`SELECT * FROM chat_background_defaults
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );

  const background = await resolveBackgroundFields(db, userId, existing, input);

  if (
    background.backgroundPreset === null &&
    background.backgroundImageId === null &&
    background.backgroundDim === null
  ) {
    if (existing !== undefined) {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM chat_background_defaults WHERE user_id = ${userId}`;
        }),
      );
    }
    return { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };
  }

  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupBackground>`INSERT INTO chat_background_defaults
          (user_id, background_preset, background_image_id, background_dim, updated_at)
        VALUES (
          ${userId},
          ${background.backgroundPreset},
          ${background.backgroundImageId},
          ${background.backgroundDim},
          ${input.now.toISOString()}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          background_preset = EXCLUDED.background_preset,
          background_image_id = EXCLUDED.background_image_id,
          background_dim = EXCLUDED.background_dim,
          updated_at = EXCLUDED.updated_at
        RETURNING background_preset, background_image_id, background_dim`;
    }),
  );
  if (!row) {
    throw new HttpError(500, 'internal_error', 'Could not save the background default');
  }
  return {
    backgroundPreset: row.backgroundPreset,
    backgroundImageId: row.backgroundImageId,
    backgroundDim: row.backgroundDim,
  };
}
