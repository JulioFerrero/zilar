import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Option, Schema } from 'effect';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { stickerFavorites, stickerPacks, stickers, userStickerPacks } from '../db/schema';
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
  const [pack] = await deps.db
    .select()
    .from(stickerPacks)
    .where(eq(stickerPacks.id, packId))
    .limit(1);
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
  const [pack] = await deps.db
    .select()
    .from(stickerPacks)
    .where(eq(stickerPacks.id, packId))
    .limit(1);
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
  const links = await deps.db
    .select()
    .from(userStickerPacks)
    .where(eq(userStickerPacks.userId, userId))
    .orderBy(asc(userStickerPacks.position), asc(userStickerPacks.addedAt));
  if (links.length === 0) {
    return [];
  }
  const packIds = links.map((link) => link.packId);
  const packs = await deps.db
    .select()
    .from(stickerPacks)
    .where(
      sql`${stickerPacks.id} IN (${sql.join(
        packIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const rows = await deps.db
    .select()
    .from(stickers)
    .where(
      sql`${stickers.packId} IN (${sql.join(
        packIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .orderBy(asc(stickers.position));
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
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-packs:${userId}`}))`);
      const [counter] = await tx
        .select({ total: count() })
        .from(stickerPacks)
        .where(eq(stickerPacks.ownerId, userId));
      if (Number(counter?.total ?? 0) >= STICKER_PACKS_MAX_PER_USER) {
        throw new HttpError(
          400,
          'pack_limit',
          `A user has at most ${STICKER_PACKS_MAX_PER_USER} packs`,
        );
      }
      const [ownLinks] = await tx
        .select({ total: count() })
        .from(userStickerPacks)
        .where(eq(userStickerPacks.userId, userId));
      await tx.insert(stickerPacks).values({
        id,
        ownerId: userId,
        title: body.title,
        visibility: body.visibility ?? 'private',
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(userStickerPacks).values({
        userId,
        packId: id,
        position: Number(ownLinks?.total ?? 0),
        addedAt: now,
      });
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const [pack] = await deps.db.select().from(stickerPacks).where(eq(stickerPacks.id, id)).limit(1);
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
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`);
    if (body.order !== undefined) {
      const rows = await tx.select().from(stickers).where(eq(stickers.packId, packId));
      const ids = new Set(rows.map((row) => row.id));
      // Completeness alone is not enough: a doubled id with a dropped one
      // passes it while corrupting the pack, so duplicates fail distinctly.
      if (new Set(body.order).size !== body.order.length) {
        throw new HttpError(400, 'duplicate_order', 'order must not list a sticker twice');
      }
      if (body.order.length !== rows.length || !body.order.every((id) => ids.has(id))) {
        throw new HttpError(400, 'invalid_request', 'order must list every sticker exactly once');
      }
      for (let index = 0; index < body.order.length; index += 1) {
        await tx
          .update(stickers)
          .set({ position: index })
          .where(and(eq(stickers.id, body.order[index]!), eq(stickers.packId, packId)));
      }
    }
    if (body.title !== undefined || body.visibility !== undefined || body.order !== undefined) {
      await tx
        .update(stickerPacks)
        .set({
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
          updatedAt: new Date(),
        })
        .where(and(eq(stickerPacks.id, packId), eq(stickerPacks.ownerId, userId)));
    }
  });
  const [updated] = await deps.db
    .select()
    .from(stickerPacks)
    .where(eq(stickerPacks.id, packId))
    .limit(1);
  if (!updated) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  const rows = await deps.db
    .select()
    .from(stickers)
    .where(eq(stickers.packId, packId))
    .orderBy(asc(stickers.position));
  return toPackView(deps, updated, rows);
}

export async function deletePack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<{ warning: string }> {
  await requireOwnedPack(deps, packId, userId);
  const rows = await deps.db.select().from(stickers).where(eq(stickers.packId, packId));
  await deps.db.delete(stickerPacks).where(eq(stickerPacks.id, packId));
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
  const conditions = [eq(stickerPacks.visibility, 'server' as const)];
  const trimmed = query?.trim() ?? '';
  if (trimmed !== '') {
    // `%`, `_` and the escape char are wildcards in LIKE: escape them so
    // `q=%` matches a literal percent instead of every pack. Drizzle's
    // `ilike` emits no ESCAPE clause, so the pattern runs as raw SQL with
    // an explicit backslash escape (still a bound parameter, no injection).
    conditions.push(
      sql`${stickerPacks.title} ILIKE ${`%${escapeLike(trimmed.slice(0, 60))}%`} ESCAPE '\\'`,
    );
  }
  if (cursor !== undefined && cursor !== '') {
    conditions.push(sql`${stickerPacks.id} > ${cursor}`);
  }
  const packs = await deps.db
    .select()
    .from(stickerPacks)
    .where(and(...conditions))
    .orderBy(asc(stickerPacks.id))
    .limit(limit + 1);
  const page = packs.slice(0, limit);
  const next = packs.length > limit && page.length > 0 ? (page[page.length - 1]!.id ?? null) : null;
  const views: StickerPackView[] = [];
  for (const pack of page) {
    const rows = await deps.db
      .select()
      .from(stickers)
      .where(eq(stickers.packId, pack.id))
      .orderBy(asc(stickers.position))
      .limit(STICKERS_MAX_PER_PACK);
    views.push(toPackView(deps, pack, rows));
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
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-panel:${userId}`}))`);
      const [existing] = await tx
        .select({ packId: userStickerPacks.packId })
        .from(userStickerPacks)
        .where(and(eq(userStickerPacks.userId, userId), eq(userStickerPacks.packId, packId)))
        .limit(1);
      if (existing) {
        return;
      }
      const [counter] = await tx
        .select({ total: count() })
        .from(userStickerPacks)
        .where(eq(userStickerPacks.userId, userId));
      if (Number(counter?.total ?? 0) >= STICKER_PANEL_MAX) {
        throw new HttpError(400, 'panel_full', `A panel holds at most ${STICKER_PANEL_MAX} packs`);
      }
      await tx.insert(userStickerPacks).values({
        userId,
        packId,
        position: Number(counter?.total ?? 0),
        addedAt: new Date(),
      });
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
}

export async function removePanelPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<void> {
  await deps.db
    .delete(userStickerPacks)
    .where(and(eq(userStickerPacks.userId, userId), eq(userStickerPacks.packId, packId)));
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
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-panel:${userId}`}))`);
      const links = await tx
        .select({ packId: userStickerPacks.packId })
        .from(userStickerPacks)
        .where(eq(userStickerPacks.userId, userId));
      const current = new Set(links.map((link) => link.packId));
      if (
        body.order.length !== links.length ||
        !body.order.every((id) => current.has(id)) ||
        new Set(body.order).size !== body.order.length
      ) {
        throw new HttpError(
          400,
          'invalid_request',
          'order must list every panel pack exactly once',
        );
      }
      for (let index = 0; index < body.order.length; index += 1) {
        await tx
          .update(userStickerPacks)
          .set({ position: index })
          .where(
            and(
              eq(userStickerPacks.userId, userId),
              eq(userStickerPacks.packId, body.order[index]!),
            ),
          );
      }
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
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
  const links = await deps.db
    .select()
    .from(stickerFavorites)
    .where(eq(stickerFavorites.userId, userId))
    .orderBy(asc(stickerFavorites.addedAt), asc(stickerFavorites.stickerId));
  if (links.length === 0) {
    return [];
  }
  // One query for all sticker rows (never one per favorite); the link order
  // is restored in memory. The links are the caller's own rows, so the
  // result stays per-user scoped.
  const ids = links.map((link) => link.stickerId);
  const rows = await deps.db.select().from(stickers).where(inArray(stickers.id, ids));
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
  const [row] = await deps.db.select().from(stickers).where(eq(stickers.id, stickerId)).limit(1);
  // An unknown id and an invisible one answer the same 404, so ids cannot
  // be probed; starring is idempotent, so no existence signal leaks either.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Sticker not found');
  }
  try {
    await deps.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-favorites:${userId}`}))`,
      );
      // A re-star is idempotent even at the cap: check for the row before
      // counting, so a lost response retried at 200 favorites still 200s.
      const [existing] = await tx
        .select({ stickerId: stickerFavorites.stickerId })
        .from(stickerFavorites)
        .where(and(eq(stickerFavorites.userId, userId), eq(stickerFavorites.stickerId, stickerId)))
        .limit(1);
      if (existing) {
        return;
      }
      const [counter] = await tx
        .select({ total: count() })
        .from(stickerFavorites)
        .where(eq(stickerFavorites.userId, userId));
      if (Number(counter?.total ?? 0) >= STICKER_FAVORITES_MAX) {
        throw new HttpError(
          400,
          'favorites_full',
          `A user has at most ${STICKER_FAVORITES_MAX} favorites`,
        );
      }
      await tx.insert(stickerFavorites).values({ userId, stickerId }).onConflictDoNothing();
    });
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
  await deps.db
    .delete(stickerFavorites)
    .where(and(eq(stickerFavorites.userId, userId), eq(stickerFavorites.stickerId, stickerId)));
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
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`);
      const [counter] = await tx
        .select({ total: count() })
        .from(stickers)
        .where(eq(stickers.packId, packId));
      if (Number(counter?.total ?? 0) >= STICKERS_MAX_PER_PACK) {
        throw new HttpError(
          400,
          'pack_full',
          `A pack holds at most ${STICKERS_MAX_PER_PACK} stickers`,
        );
      }
      const [top] = await tx
        .select({ position: stickers.position })
        .from(stickers)
        .where(eq(stickers.packId, packId))
        .orderBy(desc(stickers.position))
        .limit(1);
      await tx.insert(stickers).values({
        id,
        packId,
        position: (top?.position ?? -1) + 1,
        emoji: emojiParsed.value ?? null,
        mime: info.mime,
        width: info.width,
        height: info.height,
        bytes: bytes.byteLength,
        storageKey,
      });
      await tx
        .update(stickerPacks)
        .set({ updatedAt: new Date() })
        .where(eq(stickerPacks.id, packId));
    });
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
    await deps.db
      .delete(stickers)
      .where(eq(stickers.id, id))
      .catch(() => {});
    throw error instanceof HttpError
      ? error
      : new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const [row] = await deps.db.select().from(stickers).where(eq(stickers.id, id)).limit(1);
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
  const [row] = await deps.db
    .select()
    .from(stickers)
    .where(and(eq(stickers.id, stickerId), eq(stickers.packId, packId)))
    .limit(1);
  // A sticker id outside this pack (or a missing one) is the same 404, so
  // ids cannot be probed across packs.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Sticker not found');
  }
  await deps.db.delete(stickers).where(eq(stickers.id, stickerId));
  const { rm } = await import('node:fs/promises');
  const storageDir = resolveStorageDir(deps.storageDir);
  await rm(join(storageDir, row.storageKey), { force: true }).catch(() => {});
  await deps.db
    .update(stickerPacks)
    .set({ updatedAt: new Date() })
    .where(eq(stickerPacks.id, packId));
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
  const [row] = await deps.db.select().from(stickers).where(eq(stickers.id, stickerId)).limit(1);
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
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'sticker-packs:' + userId}))`);
      const [found] = await tx
        .select({ id: stickerPacks.id })
        .from(stickerPacks)
        .where(and(eq(stickerPacks.ownerId, userId), eq(stickerPacks.importedFrom, importedFrom)))
        .limit(1);
      if (found) {
        packId = found.id;
        return;
      }
      const [counter] = await tx
        .select({ total: count() })
        .from(stickerPacks)
        .where(eq(stickerPacks.ownerId, userId));
      if (Number(counter?.total ?? 0) >= STICKER_PACKS_MAX_PER_USER) {
        throw new HttpError(
          400,
          'pack_limit',
          `A user has at most ${STICKER_PACKS_MAX_PER_USER} packs`,
        );
      }
      const id = randomUUID();
      const stamped = new Date();
      await tx.insert(stickerPacks).values({
        id,
        ownerId: userId,
        title,
        visibility: 'private',
        importedFrom,
        createdAt: stamped,
        updatedAt: stamped,
      });
      const [ownLinks] = await tx
        .select({ total: count() })
        .from(userStickerPacks)
        .where(eq(userStickerPacks.userId, userId));
      await tx
        .insert(userStickerPacks)
        .values({ userId, packId: id, position: Number(ownLinks?.total ?? 0), addedAt: stamped })
        .onConflictDoNothing();
      packId = id;
    });
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
  // below uses `onConflictDoNothing` on the per-pack unique index, so one
  // of them wins and the loser counts as skipped.
  const known = await deps.db
    .select({ sourceId: stickers.sourceId })
    .from(stickers)
    .where(eq(stickers.packId, resolvedPackId));
  const knownIds = new Set(
    known.map((row) => row.sourceId).filter((id): id is string => id !== null),
  );
  // The whole pack size — local uploads included, not just Telegram rows —
  // so a full pack queues nothing instead of 400ing on the first store.
  const [packCounter] = await deps.db
    .select({ total: count() })
    .from(stickers)
    .where(eq(stickers.packId, resolvedPackId));
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

  const [pack] = await deps.db
    .select()
    .from(stickerPacks)
    .where(eq(stickerPacks.id, resolvedPackId))
    .limit(1);
  if (!pack) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const rows = await deps.db
    .select()
    .from(stickers)
    .where(eq(stickers.packId, resolvedPackId))
    .orderBy(asc(stickers.position));
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
  return { pack: toPackView(deps, pack, rows), imported, skippedAnimated, skippedInvalid, partial };
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
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`);
      const [counter] = await tx
        .select({ total: count() })
        .from(stickers)
        .where(eq(stickers.packId, packId));
      if (Number(counter?.total ?? 0) >= STICKERS_MAX_PER_PACK) {
        throw new HttpError(
          400,
          'pack_full',
          `A pack holds at most ${STICKERS_MAX_PER_PACK} stickers`,
        );
      }
      const [top] = await tx
        .select({ position: stickers.position })
        .from(stickers)
        .where(eq(stickers.packId, packId))
        .orderBy(desc(stickers.position))
        .limit(1);
      const rows = await tx
        .insert(stickers)
        .values({
          id,
          packId,
          position: (top?.position ?? -1) + 1,
          emoji,
          mime: info.mime,
          width: info.width,
          height: info.height,
          bytes: bytes.byteLength,
          storageKey,
          sourceId: item.sourceId,
        })
        .onConflictDoNothing()
        .returning();
      inserted = rows.length > 0;
      await tx
        .update(stickerPacks)
        .set({ updatedAt: new Date() })
        .where(eq(stickerPacks.id, packId));
    });
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
    await deps.db
      .delete(stickers)
      .where(eq(stickers.id, id))
      .catch(() => {});
    return 'skipped';
  }
  const [row] = await deps.db.select().from(stickers).where(eq(stickers.id, id)).limit(1);
  return row ? 'stored' : 'skipped';
}
