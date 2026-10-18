import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { CardMediaInsert, CardMediaRow } from '../db/rows-agents';
import { runSql } from '../effect/sql';

// Per-AI caps: `CARD_MEDIA_DAILY_MAX` counts rows created in the last 24 hours;
// `CARD_MEDIA_TOTAL_BYTES_MAX` sums the bytes of every row the AI owns.
export const CARD_MEDIA_DAILY_MAX = 40;
export const CARD_MEDIA_TOTAL_BYTES_MAX = 200 * 1024 * 1024;

export type CardMediaQuotaReason = 'daily' | 'total';

export class CardMediaQuotaError extends Error {
  readonly reason: CardMediaQuotaReason;

  constructor(reason: CardMediaQuotaReason) {
    super(
      reason === 'daily'
        ? 'This AI has reached its daily card media limit'
        : 'This AI has reached its card media storage limit',
    );
    this.name = 'CardMediaQuotaError';
    this.reason = reason;
  }
}

export interface StoreCardMediaInput {
  aiId: string;
  roomJid: string;
  groupId?: string | null;
  topicId?: string | null;
  mime: string;
  name: string;
  width?: number | null;
  height?: number | null;
  bytes: Uint8Array;
}

// The count and the bytes sum run in the same advisory-locked transaction as the insert,
// so two concurrent uploads cannot both pass a cap. The file lands after the caps pass
// and is removed if the transaction does not commit.
export async function storeCardMedia(
  db: ServerDatabase,
  dir: string,
  input: StoreCardMediaInput,
): Promise<CardMediaRow> {
  const id = randomUUID();
  // `storageKey` is server-made, never user input, so `cardMediaPath` can join it blindly.
  const storageKey = randomUUID();
  const path = join(dir, storageKey);
  const row: CardMediaInsert = {
    id,
    aiId: input.aiId,
    roomJid: input.roomJid,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    mime: input.mime,
    size: input.bytes.byteLength,
    width: input.width ?? null,
    height: input.height ?? null,
    name: input.name,
    storageKey,
  };
  await mkdir(dir, { recursive: true });

  let written = false;
  try {
    const [created] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`card-media:${row.aiId}`}))`;
            const [usage] = yield* sql<{ daily: number; total: number }>`
              SELECT
                count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS daily,
                coalesce(sum(size), 0)::int AS total
              FROM card_media
              WHERE ai_id = ${row.aiId}`;
            if ((usage?.daily ?? 0) >= CARD_MEDIA_DAILY_MAX) {
              return yield* Effect.fail(new CardMediaQuotaError('daily'));
            }
            if ((usage?.total ?? 0) + row.size > CARD_MEDIA_TOTAL_BYTES_MAX) {
              return yield* Effect.fail(new CardMediaQuotaError('total'));
            }
            yield* Effect.promise(() => writeFile(path, input.bytes));
            written = true;
            return yield* sql<CardMediaRow>`INSERT INTO card_media
                (id, ai_id, room_jid, group_id, topic_id, mime, size, width, height, name, storage_key)
              VALUES (
                ${row.id},
                ${row.aiId},
                ${row.roomJid},
                ${row.groupId},
                ${row.topicId},
                ${row.mime},
                ${row.size},
                ${row.width},
                ${row.height},
                ${row.name},
                ${row.storageKey}
              )
              RETURNING *`;
          }),
        );
      }),
    );
    if (!created) {
      throw new Error('Failed to store card media');
    }
    return created;
  } catch (error) {
    // A failed insert or commit must not leave the file behind; a failed removal leaves an
    // orphan file no row can point at.
    if (written) {
      await unlink(path).catch(() => undefined);
    }
    throw error;
  }
}

export async function getCardMedia(
  db: ServerDatabase,
  id: string,
): Promise<CardMediaRow | undefined> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<CardMediaRow>`SELECT * FROM card_media WHERE id = ${id} LIMIT 1`;
    }),
  );
  return row;
}

export function cardMediaPath(dir: string, row: CardMediaRow): string {
  return join(dir, row.storageKey);
}
