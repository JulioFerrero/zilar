import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { type StickerRow, type StickersServiceDeps, type StickerView } from './schemas';
import { toStickerView } from './storage';

// Favorites (T-0121): one user's starred stickers, at most 200, ordered by
// when they were starred. Any sticker the caller knows the id of — an
// unguessable UUID already shared inside messages — may be favorited; there
// is no visibility check, so starring can never become a private-pack oracle.

export const STICKER_FAVORITES_MAX = 200;

const favoriteBodySchema = Schema.Struct({
  sticker_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

export type FavoriteBody = typeof favoriteBodySchema.Type;
export { favoriteBodySchema };

export async function listFavorites(
  deps: StickersServiceDeps,
  userId: string,
): Promise<StickerView[]> {
  const links = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ stickerId: string }>`SELECT sticker_id FROM sticker_favorites
        WHERE user_id = ${userId}
        ORDER BY added_at ASC, sticker_id ASC`;
    }),
  );
  if (links.length === 0) {
    return [];
  }
  // One query for all sticker rows (never one per favorite); the link order
  // is restored in memory. The links are the caller's own rows, so the
  // result stays per-user scoped.
  const ids = links.map((link) => link.stickerId);
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id IN ${sql.in(ids)}`;
    }),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const views: StickerView[] = [];
  for (const link of links) {
    const row = byId.get(link.stickerId);
    if (row) {
      views.push(toStickerView(deps, row));
    }
  }
  return views;
}

export async function addFavorite(
  deps: StickersServiceDeps,
  userId: string,
  stickerId: string,
): Promise<StickerView> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${stickerId} LIMIT 1`;
    }),
  );
  // An unknown id and an invisible one answer the same 404, so ids cannot
  // be probed; starring is idempotent, so no existence signal leaks either.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Sticker not found');
  }
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-favorites:${userId}`}))`;
            // A re-star is idempotent even at the cap: check for the row before
            // counting, so a lost response retried at 200 favorites still 200s.
            const [existing] = yield* sql<{
              stickerId: string;
            }>`SELECT sticker_id FROM sticker_favorites
              WHERE user_id = ${userId} AND sticker_id = ${stickerId} LIMIT 1`;
            if (existing) {
              return;
            }
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM sticker_favorites WHERE user_id = ${userId}`;
            if (Number(counter?.total ?? 0) >= STICKER_FAVORITES_MAX) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'favorites_full',
                  `A user has at most ${STICKER_FAVORITES_MAX} favorites`,
                ),
              );
            }
            yield* sql`INSERT INTO sticker_favorites (user_id, sticker_id)
              VALUES (${userId}, ${stickerId}) ON CONFLICT DO NOTHING`;
          }),
        );
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  return toStickerView(deps, row);
}

export async function removeFavorite(
  deps: StickersServiceDeps,
  userId: string,
  stickerId: string,
): Promise<void> {
  // Idempotent: unstarring an absent favorite is still `{ ok: true }`, so
  // the answer reveals nothing about what the caller has starred.
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM sticker_favorites
        WHERE user_id = ${userId} AND sticker_id = ${stickerId}`;
    }),
  );
}
