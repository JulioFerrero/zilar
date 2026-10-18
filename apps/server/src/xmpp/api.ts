import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { XmppGroup, XmppTokenRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { syncRoster } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { xmppUnavailable } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import type { EjabberdAdminClient } from './admin-client';
import type { XmppConfig } from './config';
import { ensureXmppAccount } from './provisioning';
import { issueXmppToken } from './token';

export const TOKEN_TTL_SECONDS = 300;
// Every page load, tab and reconnect mints one token. 30 per 10 min locked a real
// user out; 120 still stops a runaway loop (one token every 5 s on average).
export const TOKEN_RATE_LIMIT_MAX = 120;
export const TOKEN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface XmppApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  xmppConfig: XmppConfig;
  now?: () => number;
  logger: Logger;
}

// The token budget runs before provisioning, as before.
const RATE_LIMIT_MESSAGE = 'Too many token requests';

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
      handler(logger, (_request, user) =>
        Effect.gen(function* () {
          const { jid, provisioned } = yield* Effect.promise(() =>
            ensureXmppAccount(deps.db, deps.adminClient, user.id, deps.xmppConfig.domain, {
              requesterId: user.id,
            }),
          );
          if (!provisioned) {
            logger.warn({ userId: user.id }, 'xmpp account could not be provisioned');
            throw xmppUnavailable();
          }

          // Retry any roster items a failed sign-up could not push; a failure is
          // not fatal, and the next request retries.
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
    Layer.provide(rateLimitLayer(XmppTokenRateLimit, limiter, RATE_LIMIT_MESSAGE)),
  );

  return mountApi(XmppApi, apiLayer);
}
