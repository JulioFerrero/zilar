import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import type { KeyCipher } from './crypto';
import { redactKey, createProviderProbe, type ProviderProbe } from './probe';
import { ProviderIdSchema, type ProviderId } from './providers';
import {
  countAisUsingConnection,
  createConnection as createConnectionRow,
  deleteConnection as deleteConnectionRow,
  findOwnedConnection,
  listConnections,
} from './service';

// Each key test calls the provider with the stored key, so cap tests per user.
export const CONNECTION_TEST_RATE_LIMIT_MAX = 5;
export const CONNECTION_TEST_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface ConnectionsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: ConnectionsLogger;
  /** Absent when GALENA_KEY_ENCRYPTION_KEY is not configured: every route then
   * answers 503 instead of touching keys. */
  cipher?: KeyCipher;
  /** Injected in tests so no request ever hits a real provider. */
  probe?: ProviderProbe;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

export interface ConnectionsLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// The only fields a caller may send. `.strict()` is load-bearing: a key that
// arrives with an unexpected field (say a provider it is not entitled to, or a
// status it wants to set) is rejected rather than silently dropped. The key is
// trimmed because pasted keys often carry a trailing newline.
const CreateConnectionSchema = z
  .object({
    provider: ProviderIdSchema,
    key: z.string().trim().min(1).max(16384),
    label: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export function createConnectionsRoutes({
  auth,
  db,
  logger,
  cipher,
  probe,
  now = Date.now,
}: ConnectionsRoutesDependencies): Hono {
  const routes = new Hono();
  const probeImpl = probe ?? createProviderProbe();
  const testLimiter = createRateLimiter({
    max: CONNECTION_TEST_RATE_LIMIT_MAX,
    windowMs: CONNECTION_TEST_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const requireCipher = (): KeyCipher => {
    if (cipher === undefined) {
      throw new HttpError(
        503,
        'connections_unavailable',
        'Provider connections are not configured on this server',
      );
    }
    return cipher;
  };

  routes.get('/connections', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    requireCipher();
    return c.json(await listConnections(db, user.id));
  });

  routes.post('/connections', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const keyCipher = requireCipher();
    const parsed = CreateConnectionSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid connection request');
    }
    const connection = await createConnectionRow(db, {
      owner: user.id,
      provider: parsed.data.provider,
      encryptedKey: keyCipher.encrypt(parsed.data.key),
      label: parsed.data.label ?? null,
    });
    return c.json(connection, 201);
  });

  routes.post('/connections/:id/test', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const keyCipher = requireCipher();
    const connection = await findOwnedConnection(db, c.req.param('id'), user.id);
    if (!connection) {
      throw new HttpError(404, 'not_found', 'Connection not found');
    }

    if (!testLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many key tests, try again in a minute');
    }

    let key: string;
    try {
      key = keyCipher.decrypt(connection.encryptedKey);
    } catch {
      logger.warn(
        { userId: user.id, connectionId: connection.id },
        'could not decrypt a stored connection key',
      );
      throw new HttpError(500, 'key_unreadable', 'The stored key could not be decrypted');
    }

    try {
      const outcome = await probeImpl.testKey(connection.provider as ProviderId, key);
      if (outcome.ok) {
        return c.json({ ok: true });
      }
      return c.json({ ok: false, message: outcome.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      logger.warn(
        {
          userId: user.id,
          connectionId: connection.id,
          err: redactKey(message, key),
        },
        'provider key test failed unexpectedly',
      );
      return c.json({ ok: false, message: 'The provider could not be reached' });
    }
  });

  routes.delete('/connections/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    requireCipher();
    const connection = await findOwnedConnection(db, c.req.param('id'), user.id);
    if (!connection) {
      throw new HttpError(404, 'not_found', 'Connection not found');
    }
    const inUse = await countAisUsingConnection(db, connection.id);
    if (inUse > 0) {
      throw new HttpError(
        409,
        'connection_in_use',
        `This connection is used by ${inUse} AI${inUse === 1 ? '' : 's'}`,
      );
    }
    const deleted = await deleteConnectionRow(db, connection.id, user.id);
    if (!deleted) {
      throw new HttpError(404, 'not_found', 'Connection not found');
    }
    return c.body(null, 204);
  });

  return routes;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
  }
}
