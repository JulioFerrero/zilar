// These routes carry provider API keys. A key never appears in a response, a
// log line or an error text: the views omit the encrypted key, decrypt/test
// failures log ids only, and a probe throw is redacted with `redactKey`.
//
// The create body is decoded inside its handler so `requireCipher` (503) still
// runs before the decode (400), as before.

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { HttpServerRequest } from 'effect/http';
import {
  CreateConnectionPayload,
  ConnectionsGroup,
  PROVIDER_IDS,
  UpdateConnectionPayload,
  type ConnectionView,
} from '@zilar/api-contract';
import type { Logger } from 'pino';
import { catalogBaseUrl, getAiCatalog } from '../ai/catalog';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { limiter, type RateLimiter } from '../rate-limit';
import { resolvePublic, validateBaseUrl } from './base-url';
import type { KeyCipher } from './crypto';
import { redactKey, createProviderProbe, type ProviderProbe } from './probe';
import type { ProviderId } from './providers';
import {
  countAisUsingConnection,
  createConnection as createConnectionRow,
  deleteConnection as deleteConnectionRow,
  findOwnedConnection,
  listConnections,
  updateConnectionKey,
  type PublicConnection,
} from './service';

// Each key test calls the provider with the stored key, so cap tests per user.

// Create resolves a host name the user chose, so both writes share one budget.

export interface ConnectionsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: ConnectionsLogger;
  /** Absent when the master key is not configured: every route answers 503. */
  cipher?: KeyCipher;
  probe?: ProviderProbe;
  now?: () => number;
}

export interface ConnectionsLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
  /** Present on the real pino logger; the warn-only route-test fake omits it. */
  error?: (fields: Record<string, unknown>, message: string) => void;
}

export interface ConnectionsApiDependencies extends ConnectionsRoutesDependencies {
  testLimiter?: RateLimiter;
  writeLimiter?: RateLimiter;
}

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// The encrypted key is not part of `PublicConnection`, so it cannot reach a
// response.
function toWire(connection: PublicConnection): ConnectionView {
  return { ...connection, createdAt: connection.createdAt.toISOString() };
}

// A symbol, so it cannot collide with a decoded JSON body.
const INVALID_JSON = Symbol('connections/invalid-json');

// The shape check runs first, then the host is resolved and a private address
// refused, so an internal host is rejected at save as well as on every later
// call. The fixed message never carries the URL.
async function validatedBaseUrl(raw: string): Promise<string> {
  try {
    const normalized = validateBaseUrl(raw);
    await resolvePublic(new URL(normalized).hostname);
    return normalized;
  } catch {
    throw new HttpError(400, 'invalid_request', 'The base URL must be a public https address');
  }
}

// A client URL is allowed only for `openai-compatible`; a catalog provider
// resolves its own base URL through the same checks, and an unknown id is 400.
async function connectionBaseUrl(
  provider: string,
  clientBaseUrl: string | undefined,
): Promise<string | null> {
  if (provider === 'openai-compatible') {
    return validatedBaseUrl(clientBaseUrl ?? '');
  }
  if ((PROVIDER_IDS as readonly string[]).includes(provider)) {
    return null;
  }
  // A cold process has no catalog map; load it once before refusing an id.
  let catalogUrl = catalogBaseUrl(provider);
  if (catalogUrl === null) {
    await getAiCatalog();
    catalogUrl = catalogBaseUrl(provider);
  }
  if (catalogUrl === null) {
    throw new HttpError(400, 'invalid_request', 'Unknown provider');
  }
  return validatedBaseUrl(catalogUrl);
}

// Declared in the contract for the derived client, but served with `handleRaw`
// because the handler decodes the body itself.
const ConnectionsApi = HttpApi.make('connections').add(ConnectionsGroup);

export function createConnectionsApi(deps: ConnectionsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const probeImpl = deps.probe ?? createProviderProbe();
  const testLimiter = deps.testLimiter ?? limiter('connectionTest', now);
  const writeLimiter = deps.writeLimiter ?? limiter('connectionWrite', now);

  // A warn-only test logger has no `error`; forward to `warn` so nothing is lost.
  const defectLogger = {
    error: (fields: Record<string, unknown>, message: string) => {
      if (deps.logger.error) {
        deps.logger.error(fields, message);
      } else {
        deps.logger.warn(fields, message);
      }
    },
  } as unknown as Logger;

  function requireCipher(): KeyCipher {
    if (deps.cipher === undefined) {
      throw new HttpError(
        503,
        'connections_unavailable',
        'Provider connections are not configured on this server',
      );
    }
    return deps.cipher;
  }

  // Shared opening of both writes: cipher (503), limit (429), JSON (400), strict decode (400).
  function readBody<S extends Schema.ConstraintDecoder<unknown>>(
    request: { readonly request: HttpServerRequest.HttpServerRequest },
    userId: string,
    schema: S,
  ): Effect.Effect<{ keyCipher: KeyCipher; body: S['Type'] }> {
    return Effect.gen(function* () {
      const keyCipher = requireCipher();
      if (!writeLimiter.allow(userId)) {
        throw new HttpError(
          429,
          'rate_limited',
          'Too many connection changes, try again in a minute',
        );
      }
      const raw = yield* request.request.json.pipe(
        Effect.catchCause(() => Effect.succeed<unknown>(INVALID_JSON)),
      );
      if (raw === INVALID_JSON) {
        throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
      }
      const decoded = Schema.decodeUnknownOption(schema, STRICT_DECODE)(raw);
      if (Option.isNone(decoded)) {
        throw new HttpError(400, 'invalid_request', 'Invalid connection request');
      }
      return { keyCipher, body: decoded.value };
    });
  }

  const groupLayer = HttpApiBuilder.group(ConnectionsApi, 'connections', (handlers) =>
    handlers
      .handle(
        'list',
        handler(defectLogger, (_request, user) => {
          requireCipher();
          return listConnections(deps.db, user.id).then((rows) => rows.map(toWire));
        }),
      )
      .handleRaw(
        'create',
        handler(defectLogger, (request, user) =>
          Effect.gen(function* () {
            const { keyCipher, body } = yield* readBody(request, user.id, CreateConnectionPayload);
            const created = yield* Effect.promise(async () => {
              const baseUrl = await connectionBaseUrl(body.provider, body.baseUrl);
              return createConnectionRow(deps.db, {
                owner: user.id,
                provider: body.provider as ProviderId,
                encryptedKey: keyCipher.encrypt(body.key),
                label: body.label ?? null,
                baseUrl,
              });
            });
            return toWire(created);
          }),
        ),
      )
      // Decoded by hand so `requireCipher` (503) runs before the decode (400). The
      // update is owner-scoped, so another user's connection answers 404. The key
      // never reaches the response or a log line.
      .handleRaw(
        'update',
        handler(defectLogger, (request, user) =>
          Effect.gen(function* () {
            const { keyCipher, body } = yield* readBody(request, user.id, UpdateConnectionPayload);
            const updated = yield* Effect.promise(() =>
              updateConnectionKey(deps.db, {
                id: request.params.id,
                owner: user.id,
                encryptedKey: keyCipher.encrypt(body.key),
              }),
            );
            if (updated === null) {
              throw new HttpError(404, 'not_found', 'Connection not found');
            }
            return toWire(updated);
          }),
        ),
      )
      .handle(
        'test',
        handler(defectLogger, (request, user) =>
          Effect.gen(function* () {
            const keyCipher = requireCipher();
            const connection = yield* Effect.promise(() =>
              findOwnedConnection(deps.db, request.params.id, user.id),
            );
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
              deps.logger.warn(
                { userId: user.id, connectionId: connection.id },
                'could not decrypt a stored connection key',
              );
              throw new HttpError(500, 'key_unreadable', 'The stored key could not be decrypted');
            }

            // A probe rejection is a defect, not a throw; map it to a value so the
            // redacted log below runs instead of a bare 500.
            const probed = yield* Effect.promise(() =>
              probeImpl.testKey(connection.provider, key, connection.baseUrl),
            ).pipe(
              Effect.map((outcome) => ({ failed: false as const, outcome })),
              Effect.catchDefect((defect) => Effect.succeed({ failed: true as const, defect })),
            );
            if (probed.failed) {
              const message =
                probed.defect instanceof Error ? probed.defect.message : 'unknown error';
              deps.logger.warn(
                {
                  userId: user.id,
                  connectionId: connection.id,
                  err: redactKey(message, key),
                },
                'provider key test failed unexpectedly',
              );
              return { ok: false as const, message: 'The provider could not be reached' };
            }
            if (probed.outcome.ok) {
              return { ok: true as const };
            }
            return { ok: false as const, message: probed.outcome.message };
          }),
        ),
      )
      // In use by an AI is a 409 with a bare count, never the AI names.
      .handle(
        'remove',
        handler(defectLogger, (request, user) =>
          Effect.gen(function* () {
            requireCipher();
            const connection = yield* Effect.promise(() =>
              findOwnedConnection(deps.db, request.params.id, user.id),
            );
            if (!connection) {
              throw new HttpError(404, 'not_found', 'Connection not found');
            }
            const inUse = yield* Effect.promise(() =>
              countAisUsingConnection(deps.db, connection.id),
            );
            if (inUse > 0) {
              throw new HttpError(
                409,
                'connection_in_use',
                `This connection is used by ${inUse} AI${inUse === 1 ? '' : 's'}`,
              );
            }
            const deleted = yield* Effect.promise(() =>
              deleteConnectionRow(deps.db, connection.id, user.id),
            );
            if (!deleted) {
              throw new HttpError(404, 'not_found', 'Connection not found');
            }
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ConnectionsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, defectLogger)),
  );

  return mountApi(ConnectionsApi, apiLayer);
}
