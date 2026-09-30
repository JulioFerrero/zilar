import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { stickerPacks, stickers, userStickerPacks } from '../db/schema';
import { HttpError } from '../errors';
import { probeErrorCode, probeStickerBytes, STICKER_MAX_BYTES } from './image';
import type { StickerImageInfo } from './image';

export const STICKER_PACKS_MAX_PER_USER = 100;
export const STICKERS_MAX_PER_PACK = 120;
export const STICKER_PACK_TITLE_MIN = 1;
export const STICKER_PACK_TITLE_MAX = 60;
export const STICKER_EMOJI_MAX = 8;
export const DISCOVER_PAGE_SIZE = 30;

export const stickerVisibilitySchema = z.enum(['private', 'server']);
export type StickerVisibility = z.infer<typeof stickerVisibilitySchema>;

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
 */
export function resolveStorageDir(dir: string): string {
  return resolve(dir);
}

const createPackBodySchema = z
  .object({
    title: z.string().trim().min(STICKER_PACK_TITLE_MIN).max(STICKER_PACK_TITLE_MAX),
    visibility: stickerVisibilitySchema.optional(),
  })
  .strict();

export type CreatePackBody = z.infer<typeof createPackBodySchema>;
export { createPackBodySchema };

const patchPackBodySchema = z
  .object({
    title: z.string().trim().min(STICKER_PACK_TITLE_MIN).max(STICKER_PACK_TITLE_MAX).optional(),
    visibility: stickerVisibilitySchema.optional(),
    order: z.array(z.string().min(1).max(128)).max(STICKERS_MAX_PER_PACK).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export type PatchPackBody = z.infer<typeof patchPackBodySchema>;
export { patchPackBodySchema };

const emojiSchema = z.string().max(STICKER_EMOJI_MAX).optional();

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
  await requireOwnedPack(deps, packId, userId);
  if (body.order !== undefined) {
    const rows = await deps.db.select().from(stickers).where(eq(stickers.packId, packId));
    const ids = new Set(rows.map((row) => row.id));
    if (body.order.length !== rows.length || !body.order.every((id) => ids.has(id))) {
      throw new HttpError(400, 'invalid_request', 'order must list every sticker exactly once');
    }
    await deps.db.transaction(async (tx) => {
      for (let index = 0; index < body.order!.length; index += 1) {
        await tx
          .update(stickers)
          .set({ position: index })
          .where(and(eq(stickers.id, body.order![index]!), eq(stickers.packId, packId)));
      }
      await tx
        .update(stickerPacks)
        .set({ updatedAt: new Date() })
        .where(eq(stickerPacks.id, packId));
    });
  }
  if (body.title !== undefined || body.visibility !== undefined) {
    await deps.db
      .update(stickerPacks)
      .set({
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
        updatedAt: new Date(),
      })
      .where(eq(stickerPacks.id, packId));
  }
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
  const emojiParsed = emojiSchema.safeParse(body.emoji);
  if (!emojiParsed.success) {
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
        emoji: emojiParsed.data ?? null,
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
