import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { STICKER_PACK_TITLE_MAX } from '@zilar/api-contract';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import {
  parseTelegramPackInput,
  TelegramImportError,
  type TelegramClient,
} from './telegram-import';
import {
  STICKER_PACKS_MAX_PER_USER,
  type StickerPackRow,
  type StickerPackView,
  type StickerRow,
  type StickersServiceDeps,
} from './schemas';
import { toPackView } from './storage';
import { storeImportedSticker } from './telegram-store';

// Telegram import: fetch a public pack's stickers into a private Zilar
// pack. At most 200 are considered and 120 imported (the pack limit); video
// stickers become animated WebP, Lottie and invalid files are skipped and
// counted, and custom emoji sets are refused. Inside the request budget it
// stops and reports `partial: true`; a re-run adds only missing stickers
// (matched by `source_id`).

export const TELEGRAM_IMPORT_CONSIDER_MAX = 200;
export const TELEGRAM_IMPORT_STICKERS_MAX = 120;
export const TELEGRAM_IMPORT_CONCURRENCY = 4;

export interface TelegramImportResult {
  pack: StickerPackView;
  imported: number;
  skippedAnimated: number;
  skippedInvalid: number;
  partial: boolean;
}

export interface TelegramImportDeps extends StickersServiceDeps {
  /** Injected in tests so the budget can expire without waiting. */
  now?: () => number;
}

export async function importTelegramPack(
  deps: TelegramImportDeps,
  userId: string,
  input: string,
  client: TelegramClient,
  deadlineMs = 30_000,
): Promise<TelegramImportResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let name: string;
  try {
    name = parseTelegramPackInput(input);
  } catch (error) {
    if (error instanceof TelegramImportError) {
      throw new HttpError(400, 'invalid_request', 'That sticker pack link is not valid');
    }
    throw error;
  }
  let set: Awaited<ReturnType<TelegramClient['getStickerSet']>>;
  try {
    set = await client.getStickerSet(name);
  } catch (error) {
    throw toImportHttpError(error);
  }
  if (set.isCustomEmoji) {
    throw new HttpError(
      400,
      'custom_emoji_unsupported',
      'Custom emoji sets cannot be imported as sticker packs',
    );
  }
  const title = set.title.trim().slice(0, STICKER_PACK_TITLE_MAX) || name;
  const importedFrom = `telegram:${set.name}`;

  // Find-or-create the pack under the user's lock: a re-run reuses its row
  // (by `imported_from`), so it fills gaps instead of duplicating. The
  // 100-pack cap is enforced in the same transaction.
  let packId: string | undefined;
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'sticker-packs:' + userId}))`;
            const [found] = yield* sql<{ id: string }>`SELECT id FROM sticker_packs
              WHERE owner_id = ${userId} AND imported_from = ${importedFrom} LIMIT 1`;
            if (found) {
              packId = found.id;
              return;
            }
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM sticker_packs WHERE owner_id = ${userId}`;
            if (Number(counter?.total ?? 0) >= STICKER_PACKS_MAX_PER_USER) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'pack_limit',
                  `A user has at most ${STICKER_PACKS_MAX_PER_USER} packs`,
                ),
              );
            }
            const id = randomUUID();
            const stamped = new Date().toISOString();
            yield* sql`INSERT INTO sticker_packs
                (id, owner_id, title, visibility, imported_from, created_at, updated_at)
              VALUES (${id}, ${userId}, ${title}, ${'private'}, ${importedFrom}, ${stamped}, ${stamped})`;
            const [ownLinks] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM user_sticker_packs WHERE user_id = ${userId}`;
            yield* sql`INSERT INTO user_sticker_packs (user_id, pack_id, position, added_at)
              VALUES (${userId}, ${id}, ${Number(ownLinks?.total ?? 0)}, ${stamped})
              ON CONFLICT DO NOTHING`;
            packId = id;
          }),
        );
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw xmppUnavailable();
  }
  if (packId === undefined) {
    throw xmppUnavailable();
  }
  const resolvedPackId = packId;

  // Stickers already imported (by `source_id`), read before the downloads;
  // `ON CONFLICT DO NOTHING` on the per-pack unique index makes the loser
  // count as skipped.
  const known = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ sourceId: string | null }>`SELECT source_id FROM stickers
        WHERE pack_id = ${resolvedPackId}`;
    }),
  );
  const knownIds = new Set(
    known.map((row) => row.sourceId).filter((id): id is string => id !== null),
  );
  // The whole pack size, local uploads included, so a full pack queues
  // nothing instead of 400ing on the first store.
  const [packCounter] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM stickers
        WHERE pack_id = ${resolvedPackId}`;
    }),
  );
  const packSize = Number(packCounter?.total ?? 0);

  const candidates = set.stickers.slice(0, TELEGRAM_IMPORT_CONSIDER_MAX);
  let skippedAnimated = 0;
  const pending: Array<{ sourceId: string; fileId: string; emoji: string | null }> = [];
  for (const entry of candidates) {
    // Only Lottie is skipped here; video entries are downloaded and converted
    // to animated WebP below.
    if (entry.animated) {
      skippedAnimated += 1;
      continue;
    }
    if (knownIds.has(entry.sourceId)) {
      continue;
    }
    pending.push({ sourceId: entry.sourceId, fileId: entry.fileId, emoji: entry.emoji });
  }

  let imported = 0;
  let skippedInvalid = 0;
  let partial = false;
  const budgetLeft = (): number => deadlineMs - (now() - startedAt);

  // Sequential batches of limited concurrency (4): Telegram downloads one
  // pack at a time, and the budget is checked between batches. At most 120 new
  // stickers land; a pack that fills mid-batch ends the import with the
  // summary, keeping earlier inserts.
  const remaining = Math.max(0, TELEGRAM_IMPORT_STICKERS_MAX - packSize);
  const queue = pending.slice(0, remaining);
  let packFull = false;
  for (let index = 0; index < queue.length; index += TELEGRAM_IMPORT_CONCURRENCY) {
    if (packFull) {
      break;
    }
    if (budgetLeft() <= 0) {
      partial = true;
      break;
    }
    const batch = queue.slice(index, index + TELEGRAM_IMPORT_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (item) => {
        let bytes: Uint8Array;
        try {
          bytes = await client.downloadFile(item.fileId);
        } catch (error) {
          // An oversized Telegram file is skipped and counted like any invalid file;
          // it never fails the whole import.
          if (error instanceof TelegramImportError && error.code === 'file_too_large') {
            return 'skipped' as const;
          }
          throw toImportHttpError(error);
        }
        return storeImportedSticker(deps, resolvedPackId, item, bytes);
      }),
    );
    for (const outcome of outcomes) {
      if (outcome === 'stored') {
        imported += 1;
      } else if (outcome === 'pack_full') {
        packFull = true;
      } else if (outcome === 'skipped') {
        skippedInvalid += 1;
      }
    }
  }

  const [pack] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs
        WHERE id = ${resolvedPackId} LIMIT 1`;
    }),
  );
  if (!pack) {
    throw xmppUnavailable();
  }
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id = ${resolvedPackId}
        ORDER BY position ASC`;
    }),
  );
  if (deps.audit) {
    await deps.audit.record({
      actorUserId: userId,
      aiId: null,
      groupId: null,
      action: 'sticker_pack.imported',
      subjectId: resolvedPackId,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { packId: resolvedPackId, imported, skippedAnimated, skippedInvalid },
    });
  }
  return {
    pack: toPackView(deps, pack, [...rows]),
    imported,
    skippedAnimated,
    skippedInvalid,
    partial,
  };
}

function toImportHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof TelegramImportError) {
    switch (error.code) {
      case 'pack_not_found':
        return new HttpError(404, 'pack_not_found', 'That Telegram sticker pack was not found');
      case 'try_later':
        return new HttpError(503, 'try_later', 'Telegram is busy, try again later');
      case 'invalid_request':
        return new HttpError(400, 'invalid_request', error.message);
      case 'invalid_token':
        // The stored token was revoked or replaced at Telegram's side after it was
        // saved. 409, not 501: the feature is configured, the credential is dead,
        // and the message names who fixes it.
        return new HttpError(
          409,
          'token_invalid',
          'The Telegram token was rejected. The server owner needs to update it.',
        );
      default:
        return new HttpError(503, 'try_later', 'Telegram is busy, try again later');
    }
  }
  return new HttpError(503, 'try_later', 'Telegram is busy, try again later');
}
