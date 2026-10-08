// Invite links module on the Effect `HttpApi` adapter (T-0566): the same
// methods, paths, statuses (201 create, 204 revoke), bodies, limiter order
// and audit calls as the deleted Hono router (`routes.ts`), mounted under
// Hono by `apps/server/src/effect/http.ts`. Handlers keep calling the drizzle
// service; the DB rewrite is a separate lane.

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  socketAddressOf,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import { clientIpFrom } from '../http/client-ip';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { InviteLinksRoutesDependencies } from './routes';
import {
  createInviteLink,
  INVITE_LINK_CREATE_MAX_EXPIRY_HOURS,
  INVITE_LINK_CREATE_MAX_USES,
  INVITE_LINK_LABEL_MAX,
  INVITE_LINK_MIN_EXPIRY_HOURS,
  INVITE_LINK_MIN_MAX_USES,
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

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// Replaces `tokenSchema` (zod): the shape check still answers the same 404
// `invalid_link`, so it runs inside the handler where the old decode did.
const InviteToken = Schema.String.check(Schema.isPattern(TOKEN_PATTERN));

// Replaces `createLinkSchema` (zod): trimmed before the length checks, exactly
// like the old `.trim().min()/.max()`.
const InviteLinkLabel = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(INVITE_LINK_LABEL_MAX),
);
const ExpiresInHours = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(INVITE_LINK_MIN_EXPIRY_HOURS),
  Schema.isLessThanOrEqualTo(INVITE_LINK_CREATE_MAX_EXPIRY_HOURS),
);
const MaxUses = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(INVITE_LINK_MIN_MAX_USES),
  Schema.isLessThanOrEqualTo(INVITE_LINK_CREATE_MAX_USES),
);

const CreateLinkBody = Schema.Struct({
  label: Schema.optional(InviteLinkLabel),
  expiresInHours: Schema.optional(ExpiresInHours),
  maxUses: Schema.optional(MaxUses),
});

const CreatedInviteLink = Schema.Struct({
  id: Schema.String,
  // The raw token, shown once at creation and never stored or listed.
  token: Schema.String,
  url: Schema.String,
});

const InviteLinkView = Schema.Struct({
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  tokenHint: Schema.String,
  uses: Schema.Number,
  maxUses: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.String),
  revoked: Schema.Boolean,
  createdAt: Schema.String,
});

const InviteLinkList = Schema.Struct({ links: Schema.Array(InviteLinkView) });

const JoinPreview = Schema.Struct({
  groupTitle: Schema.String,
  memberCount: Schema.Number,
  alreadyMember: Schema.Boolean,
  // Present only for an already-member, so previews leak no group ids.
  groupId: Schema.optional(Schema.String),
  kind: Schema.Literals(['group', 'channel']),
});

const JoinResult = Schema.Struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

const GroupIdParams = Schema.Struct({ id: Schema.String });
const InviteLinkParams = Schema.Struct({ id: Schema.String, linkId: Schema.String });
const JoinTokenParams = Schema.Struct({ token: Schema.String });

// Applied to the group so a payload decode failure renders like the old zod
// path: a 400 `invalid_request` carrying the first schema message.
class InviteLinksSchemaErrors extends HttpApiMiddleware.Service<InviteLinksSchemaErrors>()(
  'zilar/effect/http/InviteLinksSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<InviteLinksSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(InviteLinksSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

// The join preview limiter runs before the token is decoded, exactly like the
// old route's `previewLimiter.allow` -> token check order.
class InviteLinksPreviewRateLimit extends HttpApiMiddleware.Service<
  InviteLinksPreviewRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/InviteLinksPreviewRateLimit') {}

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

const InviteLinksGroup = HttpApiGroup.make('invite-links')
  .add(
    HttpApiEndpoint.post('createLink', '/groups/:id/invite-links', {
      params: GroupIdParams,
      payload: CreateLinkBody,
      success: CreatedInviteLink,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('listLinks', '/groups/:id/invite-links', {
      params: GroupIdParams,
      success: InviteLinkList,
    }),
    HttpApiEndpoint.delete('revokeLink', '/groups/:id/invite-links/:linkId', {
      params: InviteLinkParams,
      success: Schema.Void,
    }),
    HttpApiEndpoint.get('preview', '/join/:token', {
      params: JoinTokenParams,
      success: JoinPreview,
    }).middleware(InviteLinksPreviewRateLimit),
    HttpApiEndpoint.post('join', '/join/:token', {
      params: JoinTokenParams,
      success: JoinResult,
    }),
  )
  .middleware(Session)
  .middleware(InviteLinksSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const InviteLinksApi = HttpApi.make('invite-links').add(InviteLinksGroup);

export const INVITE_LINKS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'POST', path: '/api/groups/:id/invite-links' },
  { method: 'GET', path: '/api/groups/:id/invite-links' },
  { method: 'DELETE', path: '/api/groups/:id/invite-links/:linkId' },
  { method: 'GET', path: '/api/join/:token' },
  { method: 'POST', path: '/api/join/:token' },
];

export function createInviteLinksApi(deps: InviteLinksRoutesDependencies): EffectApiMount {
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
      .handle('createLink', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const link = yield* Effect.promise(() =>
              createInviteLink(serviceDeps, webBaseUrl, {
                groupId: request.params.id,
                actorId: user.id,
                ...(request.payload.label === undefined ? {} : { label: request.payload.label }),
                ...(request.payload.expiresInHours === undefined
                  ? {}
                  : { expiresInHours: request.payload.expiresInHours }),
                ...(request.payload.maxUses === undefined
                  ? {}
                  : { maxUses: request.payload.maxUses }),
              }),
            );
            return HttpServerResponse.jsonUnsafe(link, { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      // Group owner/admin lists links: the tokens are never returned.
      .handle('listLinks', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const links = yield* Effect.promise(() =>
              listInviteLinks(serviceDeps, request.params.id, user.id),
            );
            return { links };
          }),
          logger,
          requestId,
        );
      })
      // Group owner/admin revokes a link. Idempotent: revoking twice still
      // answers 204.
      .handle('revokeLink', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() =>
              revokeInviteLink(serviceDeps, request.params.id, user.id, request.params.linkId),
            );
            return HttpServerResponse.empty({ status: 204 });
          }),
          logger,
          requestId,
        );
      })
      // Join preview: group title and member count only. Unknown/expired/
      // revoked/exhausted links answer the same 404 `invalid_link`. The
      // limiter middleware already charged the budget, before the token check.
      .handle('preview', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const token = Schema.decodeUnknownOption(InviteToken)(request.params.token);
            if (Option.isNone(token)) {
              throw toInvalidLink();
            }
            return yield* Effect.promise(() =>
              previewInviteLink(serviceDeps, token.value, user.id),
            );
          }),
          logger,
          requestId,
        );
      })
      // Joins the caller as a `member`. The token check runs first, then the
      // per-user and per-IP budgets, so a malformed token costs nothing.
      .handle('join', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
            return yield* Effect.promise(() => joinByInviteLink(serviceDeps, token.value, user.id));
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(InviteLinksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(previewRateLimitLayer(previewLimiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: INVITE_LINKS_API_ROUTES };
}
