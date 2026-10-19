import type { ServerCore } from '../app/deps';
import { Effect } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { XmppGroup, XmppTokenRateLimit } from '@zilar/api-contract';

import { syncRoster } from '../contacts/service';

import { xmppUnavailable } from '../errors';
import { limiter } from '../rate-limit';
import { mountGroups, handler, type EffectApiMount } from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import type { XmppConfig } from './config';
import { ensureXmppAccount } from './provisioning';
import { issueXmppToken } from './token';

export const TOKEN_TTL_SECONDS = 300;
// Every page load, tab and reconnect mints one token. 30 per 10 min locked a real
// user out; 120 still stops a runaway loop (one token every 5 s on average).

export interface XmppApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'adminClient' | 'logger'
> {
  xmppConfig: XmppConfig;
  now?: () => number;
}

// The token budget runs before provisioning, as before.
const RATE_LIMIT_MESSAGE = 'Too many token requests';

const XmppApi = HttpApi.make('xmpp').add(XmppGroup);

export function createXmppApi(deps: XmppApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const tokenLimiter = limiter('token', now);

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

  return mountGroups(XmppApi, groupLayer, {
    auth: deps.auth,
    logger,
    extra: rateLimitLayer(XmppTokenRateLimit, tokenLimiter, RATE_LIMIT_MESSAGE),
  });
}
