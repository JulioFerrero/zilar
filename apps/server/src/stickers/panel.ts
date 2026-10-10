import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { STICKER_PANEL_MAX } from '@zilar/api-contract';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { mapStickerError, type StickersServiceDeps } from './schemas';
import { requireVisiblePack } from './storage';

// At most `STICKER_PANEL_MAX` (200) packs per panel: the reorder endpoint
// validates an exact permutation capped at the same number, so adds must never
// push past it.

export async function addPanelPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<void> {
  await requireVisiblePack(deps, packId, userId);
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-panel:${userId}`}))`;
            const [existing] = yield* sql<{ packId: string }>`SELECT pack_id FROM user_sticker_packs
              WHERE user_id = ${userId} AND pack_id = ${packId} LIMIT 1`;
            if (existing) {
              return;
            }
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM user_sticker_packs WHERE user_id = ${userId}`;
            if (Number(counter?.total ?? 0) >= STICKER_PANEL_MAX) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'panel_full',
                  `A panel holds at most ${STICKER_PANEL_MAX} packs`,
                ),
              );
            }
            yield* sql`INSERT INTO user_sticker_packs (user_id, pack_id, position, added_at)
              VALUES (${userId}, ${packId}, ${Number(counter?.total ?? 0)}, ${new Date().toISOString()})`;
          }),
        );
      }),
    );
  } catch (error) {
    throw mapStickerError(error);
  }
}

export async function removePanelPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<void> {
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM user_sticker_packs WHERE user_id = ${userId} AND pack_id = ${packId}`;
    }),
  );
}

const reorderPanelBodySchema = Schema.Struct({
  order: Schema.Array(
    Schema.String.pipe(
      Schema.check(
        Schema.makeFilter((value: string) =>
          value.length >= 1 ? undefined : 'Too small: expected string to have >=1 characters',
        ),
        Schema.makeFilter((value: string) =>
          value.length <= 128 ? undefined : 'Too big: expected string to have <=128 characters',
        ),
      ),
    ),
  ).pipe(
    Schema.check(
      Schema.makeFilter((value: ReadonlyArray<string>) =>
        value.length <= STICKER_PANEL_MAX
          ? undefined
          : `Too big: expected array to have <=${STICKER_PANEL_MAX} items`,
      ),
    ),
  ),
});

export type ReorderPanelBody = typeof reorderPanelBodySchema.Type;
export { reorderPanelBodySchema };

/**
 * Reorders the caller's panel in one transaction: the id list must be
 * exactly the caller's current panel (a permutation), so a concurrent
 * add/remove fails loudly instead of being silently overwritten.
 */
export async function reorderPanelPacks(
  deps: StickersServiceDeps,
  userId: string,
  body: ReorderPanelBody,
): Promise<void> {
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-panel:${userId}`}))`;
            const links = yield* sql<{ packId: string }>`SELECT pack_id FROM user_sticker_packs
              WHERE user_id = ${userId}`;
            const current = new Set(links.map((link) => link.packId));
            if (
              body.order.length !== links.length ||
              !body.order.every((id) => current.has(id)) ||
              new Set(body.order).size !== body.order.length
            ) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'invalid_request',
                  'order must list every panel pack exactly once',
                ),
              );
            }
            for (let index = 0; index < body.order.length; index += 1) {
              yield* sql`UPDATE user_sticker_packs SET position = ${index}
                WHERE user_id = ${userId} AND pack_id = ${body.order[index]!}`;
            }
          }),
        );
      }),
    );
  } catch (error) {
    throw mapStickerError(error);
  }
}
