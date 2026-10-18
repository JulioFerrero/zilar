import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { BlocksData } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import type { BlockCardInsert, BlockCardRow, BlockResponseRow } from '../db/rows';
import { runSql } from '../effect/sql';

// Card storage: one row per card and one per interaction. The pure merge lives
// in `apply.ts`.

export interface RecordCardInput {
  originId: string;
  aiId: string;
  groupId?: string | null;
  topicId?: string | null;
  roomJid: string;
  data: BlocksData;
}

// The caller has already validated `data` against `BlocksDataSchema`.
export async function recordCard(
  db: ServerDatabase,
  input: RecordCardInput,
): Promise<BlockCardRow> {
  const row: BlockCardInsert = {
    originId: input.originId,
    aiId: input.aiId,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    roomJid: input.roomJid,
    data: input.data,
  };
  const [created] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BlockCardRow>`INSERT INTO block_cards
          (origin_id, ai_id, group_id, topic_id, room_jid, data)
        VALUES (
          ${row.originId},
          ${row.aiId},
          ${row.groupId},
          ${row.topicId},
          ${row.roomJid},
          ${JSON.stringify(row.data)}::jsonb
        )
        RETURNING *`;
    }),
  );
  if (!created) {
    throw new Error('Failed to record card');
  }
  return created;
}

// The posted card comes back as an outgoing reflection whose stanza id
// (XEP-0359) is what clients quote, while the row keeps the origin id. Stamp it
// once, only while null. Returns whether the row changed.
export async function rekeyCard(
  db: ServerDatabase,
  originId: string,
  stanzaId: string,
): Promise<boolean> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ originId: string }>`UPDATE block_cards
        SET stanza_id = ${stanzaId}, updated_at = now()
        WHERE origin_id = ${originId} AND stanza_id IS NULL
        RETURNING origin_id`;
    }),
  );
  return updated.length > 0;
}

// Either the origin id or the stanza id a card was re-keyed to.
export async function findCard(db: ServerDatabase, id: string): Promise<BlockCardRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BlockCardRow>`SELECT * FROM block_cards
        WHERE origin_id = ${id} OR stanza_id = ${id}
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

export interface UpsertResponseInput {
  cardId: string;
  blockId: string;
  itemId: string;
  actorId: string;
  value: unknown;
}

// A checklist tick is set once per (card, block, item, actor).
export async function upsertResponse(
  db: ServerDatabase,
  input: UpsertResponseInput,
): Promise<BlockResponseRow> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BlockResponseRow>`INSERT INTO block_responses
          (card_id, block_id, item_id, actor_id, value)
        VALUES (
          ${input.cardId},
          ${input.blockId},
          ${input.itemId},
          ${input.actorId},
          ${JSON.stringify(input.value)}::jsonb
        )
        ON CONFLICT (card_id, block_id, item_id, actor_id)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        RETURNING *`;
    }),
  );
  if (!row) {
    throw new Error('Failed to store response');
  }
  return row;
}

export interface ReplacePollVotesInput {
  cardId: string;
  blockId: string;
  actorId: string;
  optionIds: string[];
}

// A poll vote is the set of options last picked, so the delete and inserts share
// one transaction.
export async function replacePollVotes(
  db: ServerDatabase,
  input: ReplacePollVotesInput,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM block_responses
            WHERE card_id = ${input.cardId}
              AND block_id = ${input.blockId}
              AND actor_id = ${input.actorId}`;
          for (const optionId of input.optionIds) {
            yield* sql`INSERT INTO block_responses
                (card_id, block_id, item_id, actor_id, value)
              VALUES (
                ${input.cardId},
                ${input.blockId},
                ${optionId},
                ${input.actorId},
                ${JSON.stringify({})}::jsonb
              )`;
          }
        }),
      );
    }),
  );
}

// Oldest first, so `applyResponses` can take the latest row per item.
export async function listResponses(
  db: ServerDatabase,
  cardId: string,
): Promise<BlockResponseRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BlockResponseRow>`SELECT * FROM block_responses
        WHERE card_id = ${cardId}
        ORDER BY updated_at, actor_id`;
    }),
  );
  return [...rows];
}

// Replaces the drawn card data. Returns whether the card exists.
export async function saveCardData(
  db: ServerDatabase,
  originId: string,
  data: BlocksData,
): Promise<boolean> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ originId: string }>`UPDATE block_cards
        SET data = ${JSON.stringify(data)}::jsonb, updated_at = now()
        WHERE origin_id = ${originId}
        RETURNING origin_id`;
    }),
  );
  return updated.length > 0;
}
