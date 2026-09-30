import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  addPanelPack,
  createPack,
  createPackBodySchema,
  deletePack,
  deleteSticker,
  discoverPacks,
  listPanelPacks,
  patchPack,
  patchPackBodySchema,
  readStickerFile,
  removePanelPack,
  uploadSticker,
  type StickersServiceDeps,
} from './service';
import { STICKER_MAX_BYTES } from './image';

export const STICKER_UPLOAD_RATE_LIMIT_MAX = 60;
export const STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface StickersRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Overrides the upload limiter (tests inject a big budget for cap tests). */
  uploadLimiter?: { allow: (key: string) => boolean };
}

// A malformed percent escape is an unknown id (404), not a server error.
function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
}

function serviceDeps(deps: StickersRoutesDependencies): StickersServiceDeps {
  return {
    db: deps.db,
    storageDir: deps.storageDir,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
}

// Reads the body chunk by chunk and stops as soon as the cap is passed, so a
// large upload never has to fit in memory.
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<Uint8Array | undefined> {
  if (body === null) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

const discoverQuerySchema = z.object({
  q: z.string().max(60).optional(),
  cursor: z.string().max(128).optional(),
});

const uploadFormSchema = z.object({ emoji: z.string().max(8).optional() }).strict();

export function createStickersRoutes(deps: StickersRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const uploadLimiter =
    deps.uploadLimiter ??
    createRateLimiter({
      max: STICKER_UPLOAD_RATE_LIMIT_MAX,
      windowMs: STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS,
      now,
    });

  routes.get('/sticker-packs', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({ packs: await listPanelPacks(serviceDeps(deps), user.id) });
  });

  routes.post('/sticker-packs', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = createPackBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    return c.json(await createPack(serviceDeps(deps), user.id, parsed.data), 201);
  });

  routes.get('/sticker-packs/discover', async (c) => {
    await requireSession(deps.auth, c.req.raw.headers);
    const parsed = discoverQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const page = await discoverPacks(serviceDeps(deps), parsed.data.q, parsed.data.cursor);
    return c.json(page);
  });

  routes.patch('/sticker-packs/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => null);
    const parsed = patchPackBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    return c.json(
      await patchPack(serviceDeps(deps), decodePathId(c.req.param('id')), user.id, parsed.data),
    );
  });

  routes.delete('/sticker-packs/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json(await deletePack(serviceDeps(deps), decodePathId(c.req.param('id')), user.id));
  });

  routes.post('/sticker-packs/:id/stickers', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!uploadLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many sticker uploads, try again later');
    }
    const contentType = c.req.header('content-type') ?? '';
    let bytes: Uint8Array;
    let emoji: string | undefined;
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData().catch(() => null);
      if (!form) {
        throw new HttpError(400, 'invalid_request', 'The upload must carry one file');
      }
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new HttpError(400, 'invalid_request', 'The upload must carry one file');
      }
      const declared = Number(c.req.header('content-length') ?? '');
      if (Number.isFinite(declared) && declared > STICKER_MAX_BYTES + 64 * 1024) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      const buffer = new Uint8Array(await file.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (buffer.byteLength > STICKER_MAX_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      bytes = buffer;
      const rawEmoji = form.get('emoji');
      if (typeof rawEmoji === 'string' && rawEmoji !== '') {
        emoji = rawEmoji;
      }
      const parsed = uploadFormSchema.safeParse(emoji === undefined ? {} : { emoji });
      if (!parsed.success) {
        throw new HttpError(
          400,
          'invalid_request',
          parsed.error.issues[0]?.message ?? 'Invalid request',
        );
      }
    } else {
      // Raw bytes: the client PUTs the file with an optional `x-emoji` header.
      const declared = Number(c.req.header('content-length') ?? '');
      if (Number.isFinite(declared) && declared > STICKER_MAX_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      const capped = await readCapped(c.req.raw.body, STICKER_MAX_BYTES);
      if (capped === undefined) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      bytes = capped;
      const rawEmoji = c.req.header('x-emoji');
      if (rawEmoji !== undefined && rawEmoji !== '') {
        emoji = rawEmoji;
      }
    }
    const sticker = await uploadSticker(
      serviceDeps(deps),
      decodePathId(c.req.param('id')),
      user.id,
      bytes,
      emoji === undefined ? {} : { emoji },
    );
    return c.json(sticker, 201);
  });

  routes.delete('/sticker-packs/:id/stickers/:stickerId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    await deleteSticker(
      serviceDeps(deps),
      decodePathId(c.req.param('id')),
      decodePathId(c.req.param('stickerId')),
      user.id,
    );
    return c.json({ ok: true });
  });

  routes.put('/sticker-panel/:packId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    await addPanelPack(serviceDeps(deps), decodePathId(c.req.param('packId')), user.id);
    return c.json({ ok: true });
  });

  routes.delete('/sticker-panel/:packId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    await removePanelPack(serviceDeps(deps), decodePathId(c.req.param('packId')), user.id);
    return c.json({ ok: true });
  });

  routes.get('/stickers/:stickerId/file', async (c) => {
    await requireSession(deps.auth, c.req.raw.headers);
    let stickerId: string;
    try {
      stickerId = decodeURIComponent(c.req.param('stickerId'));
    } catch {
      throw new HttpError(404, 'not_found', 'Sticker not found');
    }
    const file = await readStickerFile(serviceDeps(deps), stickerId);
    // An unknown id and a missing file answer the same 404.
    if (!file) {
      throw new HttpError(404, 'not_found', 'Sticker not found');
    }
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-length': String(file.size),
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        'cache-control': 'public, max-age=31536000, immutable',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  });

  return routes;
}
