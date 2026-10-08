// The XMPP token route on the Effect `HttpApi` adapter (T-0533): the same
// method, path, limiter order, logs and answer as the deleted Hono router
// (`routes.ts`), mounted under Hono by `apps/server/src/effect/http.ts`.
// Handlers keep calling the provisioning and roster services; the DB rewrite is
// a separate lane.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { syncRoster } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  CurrentUser,
  Session,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
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
class XmppTokenRateLimit extends HttpApiMiddleware.Service<
  XmppTokenRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/XmppTokenRateLimit') {}

function tokenRateLimitLayer(limiter: RateLimiter): Layer.Layer<XmppTokenRateLimit> {
  return Layer.succeed(
    XmppTokenRateLimit,
    XmppTokenRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many token requests'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const XmppGroup = HttpApiGroup.make('xmpp')
  .add(
    HttpApiEndpoint.post('token', '/xmpp/token', { success: TokenResult }).middleware(
      XmppTokenRateLimit,
    ),
  )
  .middleware(Session)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const XmppApi = HttpApi.make('xmpp').add(XmppGroup);

export const XMPP_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'POST', path: '/api/xmpp/token' },
];

export function createXmppApi(deps: XmppApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const limiter = createRateLimiter({
    max: TOKEN_RATE_LIMIT_MAX,
    windowMs: TOKEN_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(XmppApi, 'xmpp', (handlers) =>
    handlers.handle('token', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          // The token budget was already charged by `XmppTokenRateLimit`.
          const user = yield* CurrentUser;
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
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(XmppApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(tokenRateLimitLayer(limiter)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: XMPP_API_ROUTES };
}
