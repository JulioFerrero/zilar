// The chat-prefs service barrel (T-1019 size split): the old
// `chat-prefs/service.ts` contents live in `access.ts` (who may keep prefs for
// which chat) and `backgrounds.ts` (the background fields and the per-user
// background default). This path keeps the constants, the view and the pref
// reads and writes, and re-exports every name it exported before, so importers
// do not change.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { ChatPrefRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import {
  resolveBackgroundFields,
  type BackgroundFields,
  type BackgroundFieldsInput,
} from './backgrounds';

export const CHAT_PREFS_MAX_ROWS = 200;
export const CHAT_PREFS_MAX_PINNED = 20;

// The preset ids live in the shared contract (T-0892).
export { CHAT_BACKGROUND_PRESET_IDS } from '@zilar/api-contract';

export type { ChatPrefRow };

export interface ChatPrefView extends BackgroundFields {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
}

export function toChatPrefView(row: ChatPrefRow): ChatPrefView {
  return {
    chatJid: row.chatJid,
    mutedUntil: row.mutedUntil === null ? null : row.mutedUntil.toISOString(),
    archived: row.archived,
    pinnedAt: row.pinnedAt === null ? null : row.pinnedAt.toISOString(),
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
  now: Date;
}

/**
 * Partial update of one pref row. A write that lands back on all defaults
 * deletes the row instead of keeping it. Enforces the per-user row and pin
 * caps. `pinned: true` stamps `now` (keeping an existing stamp);
 * `pinned: false` clears the stamp.
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
  const background = await resolveBackgroundFields(db, input.userId, existing, input);

  if (
    mutedUntil === null &&
    archived === false &&
    pinnedAt === null &&
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
          (user_id, chat_jid, muted_until, archived, pinned_at,
            background_preset, background_image_id, background_dim, updated_at)
        VALUES (
          ${input.userId},
          ${input.bare},
          ${mutedUntil === null ? null : mutedUntil.toISOString()},
          ${archived},
          ${pinnedAt === null ? null : pinnedAt.toISOString()},
          ${background.backgroundPreset},
          ${background.backgroundImageId},
          ${background.backgroundDim},
          ${input.now.toISOString()}
        )
        ON CONFLICT (user_id, chat_jid) DO UPDATE SET
          muted_until = EXCLUDED.muted_until,
          archived = EXCLUDED.archived,
          pinned_at = EXCLUDED.pinned_at,
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

// Re-exports so every importer of this path keeps working (T-1019 size split).
export type { ChatAccess } from './access';
export { requireChatAccess } from './access';
export type {
  BackgroundFields,
  BackgroundFieldsInput,
  PutChatBackgroundDefaultInput,
} from './backgrounds';
export { getChatBackgroundDefault, putChatBackgroundDefault } from './backgrounds';
