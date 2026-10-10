// Invite links module on the Effect `HttpApi` adapter (T-0566): the same
// methods, paths, statuses (201 create, 204 revoke), bodies, limiter order
// and audit calls as the deleted router (`routes.ts`), mounted by the Effect
// edge (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.
//
// The schemas and the group live in the shared contract (`@zilar/api-contract`,
// T-0892); this file keeps the handlers and layers.

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import { CurrentUser, InviteLinksGroup, InviteLinksPreviewRateLimit } from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  sessionLayer,
  socketAddressOf,
  type EffectApiMount,
} from '../effect/http-core';
import { chainASchemaErrorLayer } from '../groups/schema-errors';
import { clientIpFrom } from '../http/client-ip';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  createInviteLink,
  JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
  JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
  JOIN_RATE_LIMIT_MAX_PER_IP,
  JOIN_RATE_LIMIT_MAX_PER_USER,
  JOIN_RATE_LIMIT_WINDOW_MS,
  joinByInviteLink,
  listInviteLinks,
  previewInviteLink,
  revokeInviteLink,
  toInvalidLink,
} from './service';

export interface InviteLinksApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
  /** Injected in tests so the join windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests; production uses the socket address. */
  getClientIp?: (request: HttpServerRequest.HttpServerRequest) => string;
  /** Injected in tests; production reads TRUSTED_PROXY_HOPS from config. */
  trustedProxyHops?: number;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

// Test seam for the join rate windows, set on the app module by
// `setTestAppInviteLinks` (see app.ts). Production never sets it.
export interface TestInviteLinksOverrides {
  now?: () => number;
  getClientIp?: (request: HttpServerRequest.HttpServerRequest) => string;
  /** Overrides TRUSTED_PROXY_HOPS in tests (the test config has no env seam). */
  trustedProxyHops?: number;
  /** Overrides the join limiters (tests inject small budgets). */
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// The shape check still answers the same 404 `invalid_link`, so it runs inside
// the handler where the old decode did; the contract keeps `:token` a string.
const InviteToken = Schema.String.check(Schema.isPattern(TOKEN_PATTERN));

// The join preview limiter runs before the token is decoded, exactly like the
// old route's `previewLimiter.allow` -> token check order.
function previewRateLimitLayer(limiter: RateLimiter): Layer.Layer<InviteLinksPreviewRateLimit> {
  return Layer.succeed(
    InviteLinksPreviewRateLimit,
    InviteLinksPreviewRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many join attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const InviteLinksApi = HttpApi.make('invite-links').add(InviteLinksGroup);

export function createInviteLinksApi(deps: InviteLinksApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const webBaseUrl = deps.config.WEB_BASE_URL;
  const now = deps.now ?? Date.now;
  const serviceDeps = {
    db: deps.db,
    adminClient: deps.adminClient,
    domain: deps.config.xmpp.domain,
    logger: deps.logger,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };

  const userJoinLimiter =
    deps.joinLimiters?.user ??
    createRateLimiter({
      max: JOIN_RATE_LIMIT_MAX_PER_USER,
      windowMs: JOIN_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const ipJoinLimiter =
    deps.joinLimiters?.ip ??
    createRateLimiter({
      max: JOIN_RATE_LIMIT_MAX_PER_IP,
      windowMs: JOIN_RATE_LIMIT_WINDOW_MS,
      now,
    });
  // The preview is a cheap read, but an unrated GET would let tokens be
  // probed at full speed: a generous per-user budget keeps that expensive.
  const previewLimiter =
    deps.joinLimiters?.preview ??
    createRateLimiter({
      max: JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
      windowMs: JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
      now,
    });

  // The per-IP join limiter reads the socket address `forwardRequest`
  // stamped; with trusted proxy hops it uses the Nth `x-forwarded-for`
  // address from the right instead. Tests inject `getClientIp`.
  const clientIp =
    deps.getClientIp ??
    ((request: HttpServerRequest.HttpServerRequest) =>
      clientIpFrom(
        {
          forwardedFor: request.headers['x-forwarded-for'],
          socketAddress: socketAddressOf(request),
        },
        deps.trustedProxyHops ?? deps.config.TRUSTED_PROXY_HOPS,
      ));

  const groupLayer = HttpApiBuilder.group(InviteLinksApi, 'invite-links', (handlers) =>
    handlers
      // Group owner/admin creates a link: the token is shown once here and
      // never stored.
      .handle(
        'createLink',
        handler(logger, (request, user) =>
          createInviteLink(serviceDeps, webBaseUrl, {
            groupId: request.params.id,
            actorId: user.id,
            ...(request.payload.label === undefined ? {} : { label: request.payload.label }),
            ...(request.payload.expiresInHours === undefined
              ? {}
              : { expiresInHours: request.payload.expiresInHours }),
            ...(request.payload.maxUses === undefined ? {} : { maxUses: request.payload.maxUses }),
          }),
        ),
      )
      // Group owner/admin lists links: the tokens are never returned.
      .handle(
        'listLinks',
        handler(logger, async (request, user) => ({
          links: await listInviteLinks(serviceDeps, request.params.id, user.id),
        })),
      )
      // Group owner/admin revokes a link. Idempotent: revoking twice still
      // answers 204.
      .handle(
        'revokeLink',
        handler(logger, async (request, user) => {
          await revokeInviteLink(serviceDeps, request.params.id, user.id, request.params.linkId);
        }),
      )
      // Join preview: group title and member count only. Unknown/expired/
      // revoked/exhausted links answer the same 404 `invalid_link`. The
      // limiter middleware already charged the budget, before the token check.
      .handle(
        'preview',
        handler(logger, async (request, user) => {
          const token = Schema.decodeUnknownOption(InviteToken)(request.params.token);
          if (Option.isNone(token)) {
            throw toInvalidLink();
          }
          return await previewInviteLink(serviceDeps, token.value, user.id);
        }),
      )
      // Joins the caller as a `member`. The token check runs first, then the
      // per-user and per-IP budgets, so a malformed token costs nothing.
      .handle(
        'join',
        handler(logger, async (request, user) => {
          const token = Schema.decodeUnknownOption(InviteToken)(request.params.token);
          if (Option.isNone(token)) {
            throw toInvalidLink();
          }
          if (!userJoinLimiter.allow(user.id)) {
            throw new HttpError(429, 'rate_limited', 'Too many join attempts, try again later');
          }
          if (!ipJoinLimiter.allow(clientIp(request.request))) {
            throw new HttpError(429, 'rate_limited', 'Too many join attempts, try again later');
          }
          return await joinByInviteLink(serviceDeps, token.value, user.id);
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(InviteLinksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(previewRateLimitLayer(previewLimiter)),
    Layer.provide(chainASchemaErrorLayer(logger)),
  );

  return mountApi(InviteLinksApi, apiLayer);
}
