import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { STICKERS_MAX_PER_PACK } from '@zilar/api-contract';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import {
  DISCOVER_PAGE_SIZE,
  mapStickerError,
  STICKER_PACKS_MAX_PER_USER,
  type CreatePackBody,
  type PatchPackBody,
  type StickerPackRow,
  type StickerPackView,
  type StickerRow,
  type StickersServiceDeps,
} from './schemas';
import {
  escapeLike,
  requireOwnedPack,
  resolveStorageDir,
  toAuditEntry,
  toPackView,
} from './storage';

export async function listPanelPacks(
  deps: StickersServiceDeps,
  userId: string,
): Promise<StickerPackView[]> {
  const links = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ packId: string }>`SELECT pack_id FROM user_sticker_packs
        WHERE user_id = ${userId}
        ORDER BY position ASC, added_at ASC`;
    }),
  );
  if (links.length === 0) {
    return [];
  }
  const packIds = links.map((link) => link.packId);
  const packs = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id IN ${sql.in(packIds)}`;
    }),
  );
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id IN ${sql.in(packIds)}
        ORDER BY position ASC`;
    }),
  );
  const byPack = new Map<string, StickerRow[]>();
  for (const row of rows) {
    const list = byPack.get(row.packId) ?? [];
    list.push(row);
    byPack.set(row.packId, list);
  }
  const views: StickerPackView[] = [];
  for (const link of links) {
    const pack = byId.get(link.packId);
    if (!pack) {
      continue;
    }
    views.push(toPackView(deps, pack, byPack.get(link.packId) ?? []));
  }
  return views;
}

export async function createPack(
  deps: StickersServiceDeps,
  userId: string,
  body: CreatePackBody,
): Promise<StickerPackView> {
  const now = new Date();
  const id = randomUUID();
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-packs:${userId}`}))`;
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
            const [ownLinks] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM user_sticker_packs WHERE user_id = ${userId}`;
            yield* sql`INSERT INTO sticker_packs (id, owner_id, title, visibility, created_at, updated_at)
              VALUES (${id}, ${userId}, ${body.title}, ${body.visibility ?? 'private'}, ${now.toISOString()}, ${now.toISOString()})`;
            yield* sql`INSERT INTO user_sticker_packs (user_id, pack_id, position, added_at)
              VALUES (${userId}, ${id}, ${Number(ownLinks?.total ?? 0)}, ${now.toISOString()})`;
          }),
        );
      }),
    );
  } catch (error) {
    throw mapStickerError(error);
  }
  const [pack] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${id} LIMIT 1`;
    }),
  );
  if (!pack) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry('sticker_pack.created', userId, id));
  }
  return toPackView(deps, pack, []);
}

export async function patchPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
  body: PatchPackBody,
): Promise<StickerPackView> {
  const owned = await requireOwnedPack(deps, packId, userId);
  // Imported packs (T-0123) are personal-use only: they can never be
  // switched to `server` visibility, so the art stays with its importer.
  if (body.visibility === 'server' && owned.importedFrom !== null && owned.importedFrom !== '') {
    throw new HttpError(400, 'imported_private', 'Imported packs stay private for personal use');
  }
  // The read, the order validation and all writes run inside one transaction
  // holding the pack's advisory lock: two concurrent reorders serialize
  // instead of interleaving positions, and a concurrent deleteSticker fails
  // the exact-once validation instead of silently dropping rows.
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`;
          if (body.order !== undefined) {
            const rows = yield* sql<{
              id: string;
            }>`SELECT id FROM stickers WHERE pack_id = ${packId}`;
            const ids = new Set(rows.map((row) => row.id));
            // Completeness alone is not enough: a doubled id with a dropped one
            // passes it while corrupting the pack, so duplicates fail distinctly.
            if (new Set(body.order).size !== body.order.length) {
              return yield* Effect.fail(
                new HttpError(400, 'duplicate_order', 'order must not list a sticker twice'),
              );
            }
            if (body.order.length !== rows.length || !body.order.every((id) => ids.has(id))) {
              return yield* Effect.fail(
                new HttpError(400, 'invalid_request', 'order must list every sticker exactly once'),
              );
            }
            for (let index = 0; index < body.order.length; index += 1) {
              yield* sql`UPDATE stickers SET position = ${index}
                WHERE id = ${body.order[index]!} AND pack_id = ${packId}`;
            }
          }
          if (
            body.title !== undefined ||
            body.visibility !== undefined ||
            body.order !== undefined
          ) {
            yield* sql`UPDATE sticker_packs SET
                title = COALESCE(${body.title ?? null}, title),
                visibility = COALESCE(${body.visibility ?? null}, visibility),
                updated_at = ${new Date().toISOString()}
              WHERE id = ${packId} AND owner_id = ${userId}`;
          }
        }),
      );
    }),
  );
  const [updated] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${packId} LIMIT 1`;
    }),
  );
  if (!updated) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id = ${packId}
        ORDER BY position ASC`;
    }),
  );
  return toPackView(deps, updated, [...rows]);
}

export async function deletePack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<{ warning: string }> {
  await requireOwnedPack(deps, packId, userId);
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id = ${packId}`;
    }),
  );
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM sticker_packs WHERE id = ${packId}`;
    }),
  );
  const { rm } = await import('node:fs/promises');
  // Files are removed after the row: a crash in between orphans files on
  // disk (harmless — they are never served without the row), never metadata.
  const storageDir = resolveStorageDir(deps.storageDir);
  for (const row of rows) {
    await rm(join(storageDir, row.storageKey), { force: true }).catch(() => {});
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry('sticker_pack.deleted', userId, packId));
  }
  return {
    warning:
      'The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker.',
  };
}

export async function discoverPacks(
  deps: StickersServiceDeps,
  query: string | undefined,
  cursor: string | undefined,
): Promise<{ packs: StickerPackView[]; next: string | null }> {
  const limit = DISCOVER_PAGE_SIZE;
  const trimmed = query?.trim() ?? '';
  const packs = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // `%`, `_` and the escape char are wildcards in LIKE: escape them so
      // `q=%` matches a literal percent instead of every pack. The pattern
      // runs as raw SQL with an explicit backslash escape (still a bound
      // parameter, no injection).
      const titleCondition =
        trimmed === ''
          ? sql``
          : sql`AND title ILIKE ${`%${escapeLike(trimmed.slice(0, 60))}%`} ESCAPE '\\'`;
      const cursorCondition =
        cursor === undefined || cursor === '' ? sql`` : sql`AND id > ${cursor}`;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs
        WHERE visibility = 'server' ${titleCondition} ${cursorCondition}
        ORDER BY id ASC
        LIMIT ${limit + 1}`;
    }),
  );
  const page = packs.slice(0, limit);
  const next = packs.length > limit && page.length > 0 ? (page[page.length - 1]!.id ?? null) : null;
  // One query for the whole page. Rows keep their position order, and each
  // pack keeps at most its first STICKERS_MAX_PER_PACK rows (the old per-pack
  // LIMIT).
  const stickersByPack = new Map<string, StickerRow[]>();
  if (page.length > 0) {
    const packIds = page.map((pack) => pack.id);
    const rows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id IN ${sql.in(packIds)}
          ORDER BY position ASC`;
      }),
    );
    for (const row of rows) {
      const list = stickersByPack.get(row.packId) ?? [];
      if (list.length < STICKERS_MAX_PER_PACK) {
        list.push(row);
      }
      stickersByPack.set(row.packId, list);
    }
  }
  const views = page.map((pack) => toPackView(deps, pack, stickersByPack.get(pack.id) ?? []));
  return { packs: views, next };
}
