import { Layer, Option, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import { InviteLinksGroup, InviteLinksPreviewRateLimit } from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { createInviteLink, listInviteLinks, revokeInviteLink } from './queries';
import {
  JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
  JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
  JOIN_RATE_LIMIT_MAX_PER_IP,
  JOIN_RATE_LIMIT_MAX_PER_USER,
  JOIN_RATE_LIMIT_WINDOW_MS,
  toInvalidLink,
} from './tokens';
import { joinByInviteLink, previewInviteLink } from './join';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  socketAddressOf,
  type EffectApiMount,
} from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { clientIpFrom } from '../http/client-ip';
import { createRateLimiter, type RateLimiter } from '../rate-limit';

export interface InviteLinksApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  audit?: AuditRecorder;
  now?: () => number;
  getClientIp?: (request: HttpServerRequest.HttpServerRequest) => string;
  trustedProxyHops?: number;
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

// Test seam for the join rate windows; production never sets it.
export interface TestInviteLinksOverrides {
  now?: () => number;
  getClientIp?: (request: HttpServerRequest.HttpServerRequest) => string;
  trustedProxyHops?: number;
  joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// The shape check answers the same 404 `invalid_link` inside the handler.
const InviteToken = Schema.String.check(Schema.isPattern(TOKEN_PATTERN));

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
  // A generous per-user budget keeps unrated GETs from probing tokens at full speed.
  const previewLimiter =
    deps.joinLimiters?.preview ??
    createRateLimiter({
      max: JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
      windowMs: JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
      now,
    });

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
      // The token is shown once here and never stored.
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
      // The tokens are never returned.
      .handle(
        'listLinks',
        handler(logger, async (request, user) => ({
          links: await listInviteLinks(serviceDeps, request.params.id, user.id),
        })),
      )
      // Idempotent: revoking twice still answers 204.
      .handle(
        'revokeLink',
        handler(logger, async (request, user) => {
          await revokeInviteLink(serviceDeps, request.params.id, user.id, request.params.linkId);
        }),
      )
      // Preview: title and member count only. Unknown, expired, revoked and exhausted
      // links answer the same 404 `invalid_link`.
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
      // Token check first, then the per-user and per-IP budgets, so a malformed token
      // costs nothing.
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
    // The preview limiter runs before the token is decoded.
    Layer.provide(
      rateLimitLayer(
        InviteLinksPreviewRateLimit,
        previewLimiter,
        'Too many join attempts, try again later',
      ),
    ),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(InviteLinksApi, apiLayer);
}
