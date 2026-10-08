import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { readStickerFile, uploadSticker, type StickersServiceDeps } from './service';
import { STICKER_MAX_BYTES } from './image';

export const STICKER_UPLOAD_RATE_LIMIT_MAX = 60;
export const STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const TELEGRAM_IMPORT_RATE_LIMIT_MAX = 3;
export const TELEGRAM_IMPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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
  /** Overrides the Telegram import limiter (tests inject a pass or a block). */
  importLimiter?: { allow: (key: string) => boolean };
  /** Injected in tests so the import never touches the network. */
  telegramClient?: import('./telegram-import').TelegramClient;
  /**
   * Resolves the bot token per request: the env value wins when set, else
   * the stored integrations value, else none. `app.ts` wires the integrations
   * resolver; tests inject a fixed value. Absent = the legacy env-only read.
   */
  getBotToken?: () => Promise<string | null>;
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

const uploadFormSchema = z.object({ emoji: z.string().max(8).optional() }).strict();

// This module keeps the two binary routes only (part B moves them later):
// `POST /sticker-packs/:id/stickers` (multipart/raw upload) and
// `GET /stickers/:stickerId/file`. The 12 JSON routes live in `./api`.
// The Hono factory below serves the binary pair under `/api`; `app.ts`
// mounts the Effect api and this factory side by side.
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
        // The client percent-encodes the emoji (header values are latin1
        // ByteStrings); decode it here with a length cap, then validate.
        let decodedEmoji = rawEmoji;
        if (decodedEmoji.includes('%')) {
          try {
            decodedEmoji = decodeURIComponent(decodedEmoji.slice(0, 64));
          } catch {
            throw new HttpError(400, 'invalid_request', 'The emoji header is not valid');
          }
        }
        emoji = decodedEmoji;
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
