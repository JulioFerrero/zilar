import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  BACKGROUND_MAX_BYTES,
  BACKGROUND_UPLOAD_RATE_LIMIT_MAX,
  BACKGROUND_UPLOAD_RATE_LIMIT_WINDOW_MS,
  deleteBackground,
  listBackgrounds,
  readBackgroundFile,
  uploadBackground,
  type BackgroundsServiceDeps,
} from './service';

export interface BackgroundsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  storageDir: string;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Overrides the upload limiter (tests inject a big budget or a block). */
  uploadLimiter?: { allow: (key: string) => boolean };
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

// A malformed percent escape is an unknown image (404), not a server error.
function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Background not found');
  }
}

function serviceDeps(deps: BackgroundsRoutesDependencies): BackgroundsServiceDeps {
  return { db: deps.db, storageDir: deps.storageDir };
}

// Background images (T-0460): upload, list, serve and delete a user's personal
// wallpapers. Every route needs a session, and every read or delete is scoped
// to the owner: an unknown id and another user's id answer the same 404.
export function createBackgroundsRoutes(deps: BackgroundsRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const uploadLimiter =
    deps.uploadLimiter ??
    createRateLimiter({
      max: BACKGROUND_UPLOAD_RATE_LIMIT_MAX,
      windowMs: BACKGROUND_UPLOAD_RATE_LIMIT_WINDOW_MS,
      now,
    });

  routes.post('/backgrounds', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!uploadLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many background uploads, try again later');
    }
    // The type comes from the magic bytes, never from this header.
    const declared = Number(c.req.header('content-length') ?? '');
    if (Number.isFinite(declared) && declared > BACKGROUND_MAX_BYTES) {
      throw new HttpError(413, 'background_too_large', 'The background image is larger than 1 MiB');
    }
    const capped = await readCapped(c.req.raw.body, BACKGROUND_MAX_BYTES);
    if (capped === undefined) {
      throw new HttpError(413, 'background_too_large', 'The background image is larger than 1 MiB');
    }
    return c.json(await uploadBackground(serviceDeps(deps), user.id, capped), 201);
  });

  routes.get('/backgrounds', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    return c.json({ backgrounds: await listBackgrounds(deps.db, user.id) });
  });

  // Streams the stored file to its owner, or to a member of a group that uses
  // it as its background (T-0463). A signed-in stranger and an unknown id
  // answer the same 404.
  routes.get('/backgrounds/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const file = await readBackgroundFile(
      serviceDeps(deps),
      decodePathId(c.req.param('id')),
      user.id,
    );
    if (!file) {
      throw new HttpError(404, 'not_found', 'Background not found');
    }
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-length': String(file.size),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'",
        // The id never changes for a stored file, so immutable is safe.
        'cache-control': 'private, max-age=31536000, immutable',
        etag: `"${c.req.param('id')}"`,
      },
    });
  });

  routes.delete('/backgrounds/:id', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const deleted = await deleteBackground(
      serviceDeps(deps),
      decodePathId(c.req.param('id')),
      user.id,
    );
    if (!deleted) {
      throw new HttpError(404, 'not_found', 'Background not found');
    }
    return c.body(null, 204);
  });

  return routes;
}
