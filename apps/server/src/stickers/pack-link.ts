// The sticker pack link (T-1495): `GET /sticker-packs/:id`. Any signed-in user
// with the id may open a pack, private or shared, so its link can be shared and
// the pack added to a panel by id. Imported packs stay personal to their
// importer: for anyone else the route answers the same 404 as an unknown id.
// The detail adds the owner's handle and whether the pack is in the caller's
// panel.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { StickerPackDetail } from '@zilar/api-contract';
import { runSql } from '../effect/sql';
import type { StickersServiceDeps } from './schemas';
import { loadPackStickers, requireVisiblePack, toPackView } from './storage';

export async function getPackDetail(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<StickerPackDetail> {
  const pack = await requireVisiblePack(deps, packId, userId);
  const [handleRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ handle: string }>`SELECT handle FROM handles
        WHERE user_id = ${pack.ownerId} LIMIT 1`;
    }),
  );
  const [panelRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ packId: string }>`SELECT pack_id FROM user_sticker_packs
        WHERE user_id = ${userId} AND pack_id = ${packId} LIMIT 1`;
    }),
  );
  return {
    ...toPackView(deps, pack, await loadPackStickers(deps, packId)),
    ownerHandle: handleRow?.handle ?? null,
    inPanel: panelRow !== undefined,
  };
}
