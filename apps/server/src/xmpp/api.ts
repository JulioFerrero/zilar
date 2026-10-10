// The XMPP token route on the Effect `HttpApi` adapter (T-0533): the same
// method, path, limiter order, logs and answer as the deleted router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its services run on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { syncRoster } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { makeRateLimit } from '../effect/rate-limit-middleware';
import type { EjabberdAdminClient } from './admin-client';
import type { XmppConfig } from './config';
import { ensureXmppAccount } from './provisioning';
import { issueXmppToken } from './token';

export const TOKEN_TTL_SECONDS = 300;
// Every page load, tab and reconnect mints one token. 30 per 10 min locked a
// real user out after a morning of reloads (2026-09-28); 120 still stops a
// runaway loop (one token every 5 s on average).
export const TOKEN_RATE_LIMIT_MAX = 120;
export const TOKEN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface XmppApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  xmppConfig: XmppConfig;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  logger: Logger;
}

const TokenResult = Schema.Struct({
  jid: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  service: Schema.String,
  domain: Schema.String,
  mucDomain: Schema.String,
});

// The token budget runs before provisioning, exactly like the old route's
// `limiter.allow` -> `ensureXmppAccount` order. `requires: CurrentUser` is
// satisfied by `Session`.
const TokenRateLimit = makeRateLimit(
  'zilar/effect/http/XmppTokenRateLimit',
  'Too many token requests',
);

const XmppGroup = HttpApiGroup.make('xmpp')
  .add(
    HttpApiEndpoint.post('token', '/xmpp/token', { success: TokenResult }).middleware(
      TokenRateLimit.Middleware,
    ),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const XmppApi = HttpApi.make('xmpp').add(XmppGroup);

export function createXmppApi(deps: XmppApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const limiter = createRateLimiter({
    max: TOKEN_RATE_LIMIT_MAX,
    windowMs: TOKEN_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(XmppApi, 'xmpp', (handlers) =>
    handlers.handle(
      'token',
      // The token budget was already charged by `TokenRateLimit`.
      handler(logger, (_request, user) =>
        Effect.gen(function* () {
          const { jid, provisioned } = yield* Effect.promise(() =>
            ensureXmppAccount(deps.db, deps.adminClient, user.id, deps.xmppConfig.domain, {
              requesterId: user.id,
            }),
          );
          if (!provisioned) {
            logger.warn({ userId: user.id }, 'xmpp account could not be provisioned');
            throw new HttpError(
              503,
              'xmpp_unavailable',
              'The chat service is temporarily unavailable',
            );
          }

          // Retry any roster items a failed sign-up could not push. A failure
          // here is not fatal: the user can still chat and the next request
          // retries.
          const roster = yield* Effect.promise(() =>
            syncRoster(deps.db, deps.adminClient, deps.xmppConfig.domain, user.id),
          );
          if (!roster.ok) {
            logger.warn({ userId: user.id, pending: roster.pending }, 'roster sync is incomplete');
          }

          const { token, expiresAt } = yield* Effect.promise(() =>
            issueXmppToken(deps.xmppConfig, jid, TOKEN_TTL_SECONDS),
          );

          return {
            jid,
            token,
            expiresAt: expiresAt.toISOString(),
            service: deps.xmppConfig.wsPublicUrl,
            domain: deps.xmppConfig.domain,
            mucDomain: deps.xmppConfig.mucDomain,
          };
        }),
      ),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(XmppApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(TokenRateLimit.layer(limiter)),
  );

  return mountApi(XmppApi, apiLayer);
}
