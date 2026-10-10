// The per-chat background fields and the per-user background default
// (T-1019 size split). Moved unchanged from `chat-prefs/service.ts`.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';

/** The three nullable background columns, shared by the pref and the default. */
export interface BackgroundFields {
  backgroundPreset: string | null;
  backgroundImageId: string | null;
  backgroundDim: number | null;
}

/** `undefined` keeps the stored value; `null` clears it. */
export interface BackgroundFieldsInput {
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

// Merges a background patch with the stored values and rejects the invalid
// combinations. An image id that does not exist and one owned by another user
// answer the same error, so an id cannot be probed. Shared by the per-chat
// pref and the per-user default.
export async function resolveBackgroundFields(
  db: ServerDatabase,
  userId: string,
  existing: BackgroundFields | undefined,
  input: BackgroundFieldsInput,
): Promise<BackgroundFields> {
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

export interface PutChatBackgroundDefaultInput extends BackgroundFieldsInput {
  now: Date;
}

/** The per-user global background default; all null when there is no row. */
export async function getChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
): Promise<BackgroundFields> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundFields>`SELECT background_preset, background_image_id, background_dim
        FROM chat_background_defaults WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };
}

/**
 * Partial update of the per-user background default. A write that lands back
 * on all defaults deletes the row instead of keeping it.
 */
export async function putChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
  input: PutChatBackgroundDefaultInput,
): Promise<BackgroundFields> {
  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundFields>`SELECT * FROM chat_background_defaults
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
      return yield* sql<BackgroundFields>`INSERT INTO chat_background_defaults
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
