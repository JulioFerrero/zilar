// Connections module on the Effect `HttpApi` adapter (T-0557): the same
// methods, paths, statuses (201 on create, 204 on delete), bodies, texts and
// per-route step order as the old router (`routes.ts`), which has since been
// deleted along with its thin wrapper; mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.
//
// These routes carry provider API keys. A key never appears in a response, a
// log line or an error text: the list/create views omit the encrypted key,
// the decrypt/test failures log ids only, and a probe throw is redacted with
// `redactKey` before it reaches the log.
//
// The create body is decoded manually inside its handler (Effect Schema, same
// rules and strictness as the old zod schema) instead of as an endpoint
// payload, so the route keeps its exact order: `requireCipher` (503) runs
// before the decode (400), exactly like the old session -> cipher -> decode
// sequence. The test limiter is checked inside its handler after the owned
// lookup (404 -> 429), for the same reason. No decode text changes: an
// invalid JSON body answers `Invalid JSON body`, a schema violation answers
// `Invalid connection request`.
//
// `ProviderIdSchema` in `./providers` is the single source of the provider
// literals, shared with the service and the probe boundary.

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  CreateConnectionPayload,
  ConnectionsServerGroup,
  type ConnectionView,
} from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { KeyCipher } from './crypto';
import { redactKey, createProviderProbe, type ProviderProbe } from './probe';
import type { ProviderId } from './providers';
import {
  countAisUsingConnection,
  createConnection as createConnectionRow,
  deleteConnection as deleteConnectionRow,
  findOwnedConnection,
  listConnections,
  type PublicConnection,
} from './service';

// Each key test calls the provider with the stored key, so cap tests per user.
export const CONNECTION_TEST_RATE_LIMIT_MAX = 5;
export const CONNECTION_TEST_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface ConnectionsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: ConnectionsLogger;
  /** Absent when ZILAR_KEY_ENCRYPTION_KEY is not configured: every route then
   * answers 503 instead of touching keys. */
  cipher?: KeyCipher;
  /** Injected in tests so no request ever hits a real provider. */
  probe?: ProviderProbe;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

export interface ConnectionsLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
  /** Present on the real pino logger; the warn-only route-test fake omits it. */
  error?: (fields: Record<string, unknown>, message: string) => void;
}

export interface ConnectionsApiDependencies extends ConnectionsRoutesDependencies {
  testLimiter?: RateLimiter;
}

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// A connection on the wire: the encrypted key is not part of `PublicConnection`
// (`./service`), so it can never reach a response; `createdAt` travels as its
// ISO string.
function toWire(connection: PublicConnection): ConnectionView {
  return { ...connection, createdAt: connection.createdAt.toISOString() };
}

// Marks a body that is not JSON at all, so the handler can answer `Invalid
// JSON body` instead of the schema-violation text (JSON never yields a symbol).
const INVALID_JSON = Symbol('connections/invalid-json');

// The server group declares no create payload: the body is decoded by hand in
// the handler (see the header). The derived clients use `ConnectionsGroup`.
const ConnectionsApi = HttpApi.make('connections').add(ConnectionsServerGroup);

export function createConnectionsApi(deps: ConnectionsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const probeImpl = deps.probe ?? createProviderProbe();
  const testLimiter =
    deps.testLimiter ??
    createRateLimiter({
      max: CONNECTION_TEST_RATE_LIMIT_MAX,
      windowMs: CONNECTION_TEST_RATE_LIMIT_WINDOW_MS,
      now,
    });

  // The envelope reports defects through `error`. The route tests may
  // inject a warn-only fake logger, which keeps `error` absent; forward to
  // `warn` only in that case so the message is never dropped.
  const defectLogger = {
    error: (fields: Record<string, unknown>, message: string) => {
      if (deps.logger.error) {
        deps.logger.error(fields, message);
      } else {
        deps.logger.warn(fields, message);
      }
    },
  } as unknown as Logger;

  // Without a cipher every route answers 503 instead of touching keys.
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

  const groupLayer = HttpApiBuilder.group(ConnectionsApi, 'connections', (handlers) =>
    handlers
      .handle(
        'list',
        handler(defectLogger, (_request, user) => {
          requireCipher();
          return listConnections(deps.db, user.id).then((rows) => rows.map(toWire));
        }),
      )
      .handle(
        'create',
        handler(defectLogger, (request, user) =>
          Effect.gen(function* () {
            const keyCipher = requireCipher();
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(INVALID_JSON)),
            );
            if (raw === INVALID_JSON) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const decoded = Schema.decodeUnknownOption(CreateConnectionPayload, STRICT_DECODE)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'Invalid connection request');
            }
            const body = decoded.value;
            const created = yield* Effect.promise(() =>
              createConnectionRow(deps.db, {
                owner: user.id,
                provider: body.provider,
                encryptedKey: keyCipher.encrypt(body.key),
                label: body.label ?? null,
              }),
            );
            return toWire(created);
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

            // A probe rejection surfaces as a defect, which `yield*` does not
            // throw into a surrounding `try`; map it to a value so the
            // redacted log below runs instead of a bare 500.
            const probed = yield* Effect.promise(() =>
              probeImpl.testKey(connection.provider as ProviderId, key),
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
      // Deletes a connection (204, no body). In use by an AI is a 409 with a
      // bare count, never the AI names.
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
