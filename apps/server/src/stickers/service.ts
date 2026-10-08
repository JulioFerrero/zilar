import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { Effect, Option, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { stickerPacks, stickers } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { probeErrorCode, probeStickerBytes, STICKER_MAX_BYTES } from './image';
import type { StickerImageInfo } from './image';
import {
  parseTelegramPackInput,
  TelegramImportError,
  type TelegramClient,
} from './telegram-import';

export const STICKER_PACKS_MAX_PER_USER = 100;
export const STICKERS_MAX_PER_PACK = 120;
export const STICKER_PACK_TITLE_MIN = 1;
export const STICKER_PACK_TITLE_MAX = 60;
export const STICKER_EMOJI_MAX = 8;
export const DISCOVER_PAGE_SIZE = 30;

export const stickerVisibilitySchema = Schema.Literals(['private', 'server']);
export type StickerVisibility = typeof stickerVisibilitySchema.Type;

export type StickerRow = typeof stickers.$inferSelect;
export type StickerPackRow = typeof stickerPacks.$inferSelect;

export interface StickerView {
  id: string;
  packId: string;
  emoji: string | null;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface StickerPackView {
  id: string;
  ownerId: string;
  title: string;
  visibility: StickerVisibility;
  /** Set by the Telegram importer (`telegram:<name>`); absent otherwise. */
  importedFrom?: string;
  stickers: StickerView[];
  createdAt: string;
  updatedAt: string;
}

export interface StickersServiceDeps {
  db: ServerDatabase;
  /** Directory sticker files are stored under; resolved once, absolutely. */
  storageDir: string;
  /** Base path of the file route, e.g. `/api/stickers`. */
  fileBasePath?: string;
  audit?: AuditRecorder;
}

// Every function in this module runs on the `effect/sql` client registered for
// this database (see `../effect/sql`). The exported functions stay `async` so
// routes and tests keep their shape.
function runSql<A>(
  deps: StickersServiceDeps,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(deps.db).runPromise(effect);
}

// A pack or panel write answers 503 for any failure that is not the module's
// own `HttpError`. A failure raised inside the effect/sql transaction keeps
// its `HttpError` instance (the pins pattern), so a 400 never becomes a 503.
function mapStickerError(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

/**
 * Resolves the storage dir once (absolute, normalized), so path comparisons
 * below hold for relative configs like the default `./data/stickers`.
 *
 * Relative values resolve against the server package root (`apps/server`),
 * not the process cwd: the Dockerfile starts from `/app` while a developer
 * may start from the repo root, and both must land on the same directory.
 * Absolute values pass through unchanged. Documented in
 * `docs/SERVER_CONFIG.md` (Stickers).
 */
export function resolveStorageDir(dir: string, baseDir: string = SERVER_PACKAGE_ROOT): string {
  if (isAbsolute(dir)) {
    return resolve(dir);
  }
  return resolve(baseDir, dir);
}

/** The server package root (`apps/server`), the base for relative storage dirs. */
export function serverPackageRoot(from: string = fileURLToPath(import.meta.url)): string {
  // Walk up from the caller's file until the directory holding the
  // `package.json` named `@zilar/server`: relative storage dirs resolve
  // against the package root whatever the file's depth below it, and a
  // build step that changes the output shape (e.g. `src/` → `dist/`)
  // resolves to the same root instead of moving a directory up or down.
  // The walk stops at the filesystem root: without the package marker it
  // returns the root itself, so a misplaced file resolves against `/`.
  let directory = dirname(from);
  for (;;) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          (parsed as { name?: unknown }).name === '@zilar/server'
        ) {
          return directory;
        }
      } catch {
        // Not JSON (or unreadable): keep walking up, it is not our marker.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return directory;
    }
    directory = parent;
  }
}

export const SERVER_PACKAGE_ROOT: string = serverPackageRoot();

// The pack title, trimmed before the length checks, exactly like the old
// `.trim().min()/.max()`. The messages cannot use `{ message }` on the
// length checks (Effect 4.0.2 drops it), so the filters return the texts.
const packTitleSchema = Schema.Trim.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      value.length >= STICKER_PACK_TITLE_MIN
        ? undefined
        : `Too small: expected string to have >=${STICKER_PACK_TITLE_MIN} characters`,
    ),
    Schema.makeFilter((value: string) =>
      value.length <= STICKER_PACK_TITLE_MAX
        ? undefined
        : `Too big: expected string to have <=${STICKER_PACK_TITLE_MAX} characters`,
    ),
  ),
);

const packOrderSchema = Schema.Array(
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
      value.length <= STICKERS_MAX_PER_PACK
        ? undefined
        : `Too big: expected array to have <=${STICKERS_MAX_PER_PACK} items`,
    ),
  ),
);

const createPackBodySchema = Schema.Struct({
  title: packTitleSchema,
  visibility: Schema.optional(stickerVisibilitySchema),
});

export type CreatePackBody = typeof createPackBodySchema.Type;
export { createPackBodySchema };

const patchPackBodySchema = Schema.Struct({
  title: Schema.optional(packTitleSchema),
  visibility: Schema.optional(stickerVisibilitySchema),
  order: Schema.optional(packOrderSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
  ),
);

export type PatchPackBody = typeof patchPackBodySchema.Type;
export { patchPackBodySchema };

const emojiSchema = Schema.optional(
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value: string) =>
        value.length <= STICKER_EMOJI_MAX ? undefined : 'emoji must be at most 8 characters',
      ),
    ),
  ),
);

export type UploadStickerBody = { emoji?: string | undefined };

function stickerUrl(deps: StickersServiceDeps, stickerId: string): string {
  return `${deps.fileBasePath ?? '/api/stickers'}/${encodeURIComponent(stickerId)}/file`;
}

export function toStickerView(deps: StickersServiceDeps, row: StickerRow): StickerView {
  return {
    id: row.id,
    packId: row.packId,
    emoji: row.emoji,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    url: stickerUrl(deps, row.id),
  };
}

export function toPackView(
  deps: StickersServiceDeps,
  pack: StickerPackRow,
  rows: StickerRow[],
): StickerPackView {
  const ordered = [...rows].sort((left, right) => left.position - right.position);
  return {
    id: pack.id,
    ownerId: pack.ownerId,
    title: pack.title,
    visibility: pack.visibility as StickerVisibility,
    ...(pack.importedFrom === null || pack.importedFrom === ''
      ? {}
      : { importedFrom: pack.importedFrom }),
    stickers: ordered.map((row) => toStickerView(deps, row)),
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
  };
}

function toAuditEntry(action: string, actorUserId: string, subjectId: string) {
  return {
    actorUserId,
    aiId: null as string | null,
    groupId: null as string | null,
    action,
    subjectId,
    argsHash: null as string | null,
    costCurrency: null as 'EUR' | 'USD' | null,
    costAmount: null as number | null,
    result: 'ok' as const,
    detail: { packId: subjectId },
  };
}

// A private pack the caller does not own is the same 404 as a missing id, so
// pack ids cannot be probed.
async function requireVisiblePack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<StickerPackRow> {
  const [pack] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${packId} LIMIT 1`;
    }),
  );
  if (!pack) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  if (pack.visibility !== 'server' && pack.ownerId !== userId) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  return pack;
}

async function requireOwnedPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<StickerPackRow> {
  const [pack] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${packId} LIMIT 1`;
    }),
  );
  // Non-owners get the same 404 as a missing id (never 403), so private
  // pack ids cannot be probed — and a missing pack never leaks whether the
  // visibility would have allowed it.
  if (!pack || pack.ownerId !== userId) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  return pack;
}

export async function listPanelPacks(
  deps: StickersServiceDeps,
  userId: string,
): Promise<StickerPackView[]> {
  const links = await runSql(
    deps,
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
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id IN ${sql.in(packIds)}`;
    }),
  );
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const rows = await runSql(
    deps,
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
    await sqlRuntimeFor(deps.db).runPromise(
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
    deps,
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
  await sqlRuntimeFor(deps.db).runPromise(
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
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${packId} LIMIT 1`;
    }),
  );
  if (!updated) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  const rows = await runSql(
    deps,
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
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id = ${packId}`;
    }),
  );
  await runSql(
    deps,
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
    deps,
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
  const views: StickerPackView[] = [];
  for (const pack of page) {
    const rows = await runSql(
      deps,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<StickerRow>`SELECT * FROM stickers WHERE pack_id = ${pack.id}
          ORDER BY position ASC
          LIMIT ${STICKERS_MAX_PER_PACK}`;
      }),
    );
    views.push(toPackView(deps, pack, [...rows]));
  }
  return { packs: views, next };
}

// At most 200 packs per panel: the reorder endpoint validates an exact
// permutation capped at the same number, so adds must never push past it.
export const STICKER_PANEL_MAX = 200;

export async function addPanelPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<void> {
  await requireVisiblePack(deps, packId, userId);
  try {
    await sqlRuntimeFor(deps.db).runPromise(
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
    deps,
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
    await sqlRuntimeFor(deps.db).runPromise(
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
    deps,
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
    deps,
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
    deps,
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
    await sqlRuntimeFor(deps.db).runPromise(
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
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM sticker_favorites
        WHERE user_id = ${userId} AND sticker_id = ${stickerId}`;
    }),
  );
}

function extensionFor(mime: 'image/webp' | 'image/png'): string {
  return mime === 'image/webp' ? 'webp' : 'png';
}

/** Escapes LIKE wildcards (`%`, `_`, `\`) in a user query fragment. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function uploadSticker(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
  bytes: Uint8Array,
  body: UploadStickerBody,
): Promise<StickerView> {
  await requireOwnedPack(deps, packId, userId);
  if (bytes.byteLength === 0) {
    throw new HttpError(400, 'sticker_empty', 'The sticker file is empty');
  }
  if (bytes.byteLength > STICKER_MAX_BYTES) {
    throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
  }
  const probed = probeStickerBytes(bytes);
  if (!probed.ok) {
    throw new HttpError(400, probeErrorCode(probed.error), 'The file is not a supported sticker');
  }
  const info: StickerImageInfo = probed.info;
  const emojiParsed = Schema.decodeUnknownOption(emojiSchema)(body.emoji);
  if (Option.isNone(emojiParsed)) {
    throw new HttpError(400, 'invalid_request', 'emoji must be at most 8 characters');
  }
  const id = randomUUID();
  const storageKey = `${id}.${extensionFor(info.mime)}`;
  try {
    await sqlRuntimeFor(deps.db).runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`;
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM stickers WHERE pack_id = ${packId}`;
            if (Number(counter?.total ?? 0) >= STICKERS_MAX_PER_PACK) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'pack_full',
                  `A pack holds at most ${STICKERS_MAX_PER_PACK} stickers`,
                ),
              );
            }
            const [top] = yield* sql<{ position: number }>`SELECT position FROM stickers
              WHERE pack_id = ${packId}
              ORDER BY position DESC LIMIT 1`;
            yield* sql`INSERT INTO stickers
                (id, pack_id, position, emoji, mime, width, height, bytes, storage_key)
              VALUES (${id}, ${packId}, ${(top?.position ?? -1) + 1}, ${emojiParsed.value ?? null},
                ${info.mime}, ${info.width}, ${info.height}, ${bytes.byteLength}, ${storageKey})`;
            yield* sql`UPDATE sticker_packs SET updated_at = ${new Date().toISOString()}
              WHERE id = ${packId}`;
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
  const storageDir = resolveStorageDir(deps.storageDir);
  try {
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, storageKey), bytes);
  } catch (error) {
    // The file never landed: remove the orphan metadata row so the sticker
    // does not 404 forever, then fail like any other write error.
    await runSql(
      deps,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM stickers WHERE id = ${id}`;
      }),
    ).catch(() => {});
    throw error instanceof HttpError
      ? error
      : new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const [row] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${id} LIMIT 1`;
    }),
  );
  if (!row) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  return toStickerView(deps, row);
}

export async function deleteSticker(
  deps: StickersServiceDeps,
  packId: string,
  stickerId: string,
  userId: string,
): Promise<void> {
  await requireOwnedPack(deps, packId, userId);
  const [row] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers
        WHERE id = ${stickerId} AND pack_id = ${packId} LIMIT 1`;
    }),
  );
  // A sticker id outside this pack (or a missing one) is the same 404, so
  // ids cannot be probed across packs.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Sticker not found');
  }
  await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM stickers WHERE id = ${stickerId}`;
    }),
  );
  const { rm } = await import('node:fs/promises');
  const storageDir = resolveStorageDir(deps.storageDir);
  await rm(join(storageDir, row.storageKey), { force: true }).catch(() => {});
  await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE sticker_packs SET updated_at = ${new Date().toISOString()}
        WHERE id = ${packId}`;
    }),
  );
}

export interface StickerFile {
  bytes: Uint8Array;
  mime: 'image/webp' | 'image/png';
  size: number;
}

export async function readStickerFile(
  deps: StickersServiceDeps,
  stickerId: string,
): Promise<StickerFile | null> {
  const [row] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${stickerId} LIMIT 1`;
    }),
  );
  if (!row) {
    return null;
  }
  // The path is built from the stored key only (a `<uuid>.<ext>` written at
  // upload); the request id never touches the filesystem, so `..` or a
  // crafted name cannot escape the storage directory. Both sides are
  // resolved, so a relative `STICKER_STORAGE_DIR` (e.g. `./data/stickers`)
  // still compares equal to its own join.
  const storageDir = resolveStorageDir(deps.storageDir);
  const filePath = join(storageDir, row.storageKey);
  if (dirname(filePath) !== storageDir) {
    return null;
  }
  const { readFile } = await import('node:fs/promises');
  try {
    const data = await readFile(filePath);
    return { bytes: new Uint8Array(data), mime: row.mime, size: row.bytes };
  } catch {
    return null;
  }
}

// Telegram import (T-0123): fetch a public pack's static stickers into a
// private Zilar pack. At most 200 stickers are considered and 120 imported
// (the pack limit); animated/video stickers and invalid files are skipped
// and counted; custom emoji sets are refused. The import runs inside the
// request budget (`deadlineMs`): when the time is up it stops and reports
// `partial: true`, and a re-run adds only the missing stickers (matched by
// `source_id`, Telegram's `file_unique_id`).

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

  // Find-or-create the pack under the user's lock: a re-run of the same
  // Telegram pack reuses its row (matched by `imported_from`), so it fills
  // gaps instead of duplicating. The 100-packs cap is enforced in the same
  // transaction, so two racing imports cannot both win.
  let packId: string | undefined;
  try {
    await sqlRuntimeFor(deps.db).runPromise(
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
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (packId === undefined) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const resolvedPackId = packId;

  // Stickers already imported (by `source_id`), read before the downloads
  // start. A concurrent import may add a row we also store: the insert
  // below uses `ON CONFLICT DO NOTHING` on the per-pack unique index, so one
  // of them wins and the loser counts as skipped.
  const known = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ sourceId: string | null }>`SELECT source_id FROM stickers
        WHERE pack_id = ${resolvedPackId}`;
    }),
  );
  const knownIds = new Set(
    known.map((row) => row.sourceId).filter((id): id is string => id !== null),
  );
  // The whole pack size — local uploads included, not just Telegram rows —
  // so a full pack queues nothing instead of 400ing on the first store.
  const [packCounter] = await runSql(
    deps,
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
  // pack at a time without hammering either side, and the request budget is
  // checked between batches so the import stops on time. At most 120 new
  // stickers land (the pack limit); the rest wait for a later run. A pack
  // that fills mid-batch (a concurrent writer, or local stickers landed
  // after the count above) ends the import with the summary — earlier
  // batches' inserts stay and are reported, never a 400.
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
          // An oversized Telegram file is skipped and counted like any
          // file that fails validation — it never fails the whole import.
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
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs
        WHERE id = ${resolvedPackId} LIMIT 1`;
    }),
  );
  if (!pack) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const rows = await runSql(
    deps,
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
        // The stored (or env) token was revoked or replaced at Telegram's
        // side after it was saved. 409, not 501: the feature IS configured,
        // the credential is just dead — and the message names who fixes it.
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

// Validates (the same magic-byte probe as uploads) and stores one imported
// sticker. A file that fails validation is skipped, never stored; a
// concurrent duplicate insert wins nothing (`onConflictDoNothing` on the
// per-pack `source_id` index) writes no file and is not counted, like a
// sticker already in the pack; a full pack reports
// `pack_full` so the caller ends the import with a summary instead of a 400
// (a double-submitted import races safely through the same path).
async function storeImportedSticker(
  deps: TelegramImportDeps,
  packId: string,
  item: { sourceId: string; fileId: string; emoji: string | null },
  bytes: Uint8Array,
): Promise<'stored' | 'skipped' | 'duplicate' | 'pack_full'> {
  if (bytes.byteLength === 0 || bytes.byteLength > STICKER_MAX_BYTES) {
    return 'skipped';
  }
  const probed = probeStickerBytes(bytes);
  if (!probed.ok) {
    return 'skipped';
  }
  const info: StickerImageInfo = probed.info;
  const emojiParsed = Schema.decodeUnknownOption(emojiSchema)(item.emoji ?? undefined);
  const emoji = Option.isNone(emojiParsed) ? null : (emojiParsed.value ?? null);
  const id = randomUUID();
  const extension = info.mime === 'image/webp' ? 'webp' : 'png';
  const storageKey = `${id}.${extension}`;
  let inserted = false;
  try {
    await sqlRuntimeFor(deps.db).runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`;
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM stickers WHERE pack_id = ${packId}`;
            if (Number(counter?.total ?? 0) >= STICKERS_MAX_PER_PACK) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'pack_full',
                  `A pack holds at most ${STICKERS_MAX_PER_PACK} stickers`,
                ),
              );
            }
            const [top] = yield* sql<{ position: number }>`SELECT position FROM stickers
              WHERE pack_id = ${packId}
              ORDER BY position DESC LIMIT 1`;
            const stored = yield* sql<{ id: string }>`INSERT INTO stickers
                (id, pack_id, position, emoji, mime, width, height, bytes, storage_key, source_id)
              VALUES (${id}, ${packId}, ${(top?.position ?? -1) + 1}, ${emoji}, ${info.mime},
                ${info.width}, ${info.height}, ${bytes.byteLength}, ${storageKey}, ${item.sourceId})
              ON CONFLICT DO NOTHING RETURNING id`;
            inserted = stored.length > 0;
            yield* sql`UPDATE sticker_packs SET updated_at = ${new Date().toISOString()}
              WHERE id = ${packId}`;
          }),
        );
      }),
    );
  } catch (error) {
    // `pack_full` is a graceful outcome, not a request failure: the batch
    // loop stops queuing and the import answers with its summary.
    if (error instanceof HttpError && error.code === 'pack_full') {
      return 'pack_full';
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (!inserted) {
    return 'duplicate';
  }
  const storageDir = resolveStorageDir(deps.storageDir);
  try {
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, storageKey), bytes);
  } catch {
    await runSql(
      deps,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM stickers WHERE id = ${id}`;
      }),
    ).catch(() => {});
    return 'skipped';
  }
  const [row] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${id} LIMIT 1`;
    }),
  );
  return row ? 'stored' : 'skipped';
}
