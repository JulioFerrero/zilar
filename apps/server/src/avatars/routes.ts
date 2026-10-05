import { Hono } from 'hono';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  AVATAR_MAX_BYTES,
  AVATAR_UPLOAD_RATE_LIMIT_MAX,
  AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS,
  avatarOwnerKindSchema,
  checkAvatarWritePermission,
  deleteAvatar,
  readAvatarFile,
  uploadAvatar,
  type AvatarsServiceDeps,
  type AvatarKind,
} from './service';

export interface AvatarsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Overrides the upload limiter (tests inject a big budget or a block). */
  uploadLimiter?: { allow: (key: string) => boolean };
}

// Reads the body chunk by chunk and stops as soon as the cap is passed, so
// a large upload never has to fit in memory.
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

// A malformed percent escape is an unknown owner (404), not a server error.
function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Avatar not found');
  }
}

function serviceDeps(deps: AvatarsRoutesDependencies): AvatarsServiceDeps {
  return {
    db: deps.db,
    storageDir: deps.storageDir,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
}

export function createAvatarsRoutes(deps: AvatarsRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const uploadLimiter =
    deps.uploadLimiter ??
    createRateLimiter({
      max: AVATAR_UPLOAD_RATE_LIMIT_MAX,
      windowMs: AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS,
      now,
    });

  routes.put('/avatars/:kind/:ownerId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const kind = avatarOwnerKindSchema.safeParse(c.req.param('kind'));
    if (!kind.success) {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    const ownerId = decodePathId(c.req.param('ownerId'));
    const avatarKind: AvatarKind = kind.data;
    // The permission check runs before the rate-limit budget is spent, so a
    // stranger probing ids cannot burn the owner's budget — and an unknown
    // owner, a wrong kind and a stranger all answer the same 404.
    await checkAvatarWritePermission(deps.db, avatarKind, ownerId, user.id);
    if (!uploadLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many avatar uploads, try again later');
    }
    // The type comes from the magic bytes, never from this header.
    const declared = Number(c.req.header('content-length') ?? '');
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
      throw new HttpError(413, 'avatar_too_large', 'The picture is larger than 256 KiB');
    }
    const capped = await readCapped(c.req.raw.body, AVATAR_MAX_BYTES);
    if (capped === undefined) {
      throw new HttpError(413, 'avatar_too_large', 'The picture is larger than 256 KiB');
    }
    return c.json(await uploadAvatar(serviceDeps(deps), avatarKind, ownerId, user.id, capped));
  });

  routes.delete('/avatars/:kind/:ownerId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    const kind = avatarOwnerKindSchema.safeParse(c.req.param('kind'));
    if (!kind.success) {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    await deleteAvatar(serviceDeps(deps), kind.data, decodePathId(c.req.param('ownerId')), user.id);
    return c.json({ ok: true });
  });

  // Streams the stored file. The id is a random unguessable uuid and a
  // signed-in session is required — but the URL is a capability for
  // signed-in users, not a secret: anyone handed the exact URL who is
  // signed in can load it. Private-group pictures are therefore not listed
  // anywhere a stranger can enumerate (no directory, no member list for
  // non-admins), yet no per-viewer membership check runs here.
  routes.get('/avatars/:id', async (c) => {
    await requireSession(deps.auth, c.req.raw.headers);
    let avatarId: string;
    try {
      avatarId = decodeURIComponent(c.req.param('id'));
    } catch {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    const file = await readAvatarFile(serviceDeps(deps), avatarId);
    // An unknown id and a missing file answer the same 404.
    if (!file) {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-length': String(file.size),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'",
        // The id changes on every replacement, so immutable is safe.
        'cache-control': 'private, max-age=31536000, immutable',
        etag: `"${avatarId}"`,
      },
    });
  });

  return routes;
}
