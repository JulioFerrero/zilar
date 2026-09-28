import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { KeyCipher } from './crypto';
import { redactKey, createProviderProbe, type ProviderProbe } from './probe';
import { ProviderIdSchema, type ProviderId } from './providers';
import {
  createConnection as createConnectionRow,
  deleteConnection as deleteConnectionRow,
  findOwnedConnection,
  listConnections,
} from './service';

export interface ConnectionsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: ConnectionsLogger;
  cipher: KeyCipher;
  /** Injected in tests so no request ever hits a real provider. */
  probe?: ProviderProbe;
}

export interface ConnectionsLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// The only fields a caller may send. `.strict()` is load-bearing: a key that
// arrives with an unexpected field (say a provider it is not entitled to, or a
// status it wants to set) is rejected rather than silently dropped.
const CreateConnectionSchema = z
  .object({
    provider: ProviderIdSchema,
    key: z.string().min(1).max(16384),
    label: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export function createConnectionsRoutes({
  auth,
  db,
  logger,
  cipher,
  probe,
}: ConnectionsRoutesDependencies): Hono {
  const routes = new Hono();
  const probeImpl = probe ?? createProviderProbe();

  routes.get('/connections', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    return c.json(await listConnections(db, user.id));
  });

  routes.post('/connections', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const parsed = CreateConnectionSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid connection request');
    }
    const connection = await createConnectionRow(db, {
      owner: user.id,
      provider: parsed.data.provider,
      encryptedKey: cipher.encrypt(parsed.data.key),
      label: parsed.data.label ?? null,
    });
    return c.json(connection, 201);
  });

  routes.post('/connections/:id/test', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const connection = await findOwnedConnection(db, c.req.param('id'), user.id);
    if (!connection) {
      throw new HttpError(404, 'not_found', 'Connection not found');
    }

    let key: string;
    try {
      key = cipher.decrypt(connection.encryptedKey);
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
    const deleted = await deleteConnectionRow(db, c.req.param('id'), user.id);
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
