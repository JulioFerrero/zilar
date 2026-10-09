// Chat preferences on the Effect `HttpApi` adapter (T-0520): the same methods,
// paths, limiter order and answers as the deleted Hono router (`routes.ts`),
// mounted under Hono by `apps/server/src/effect/http.ts`. Handlers keep calling
// the drizzle service; the DB rewrite is a separate lane.

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
import { IsoDateTimeSchema } from '@zilar/protocol';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import {
  CHAT_BACKGROUND_PRESET_IDS,
  getChatBackgroundDefault,
  listChatPrefs,
  putChatBackgroundDefault,
  putChatPref,
  requireChatAccess,
} from './service';

export const CHAT_PREFS_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_PREFS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const BackgroundPreset = Schema.Literals(CHAT_BACKGROUND_PRESET_IDS);

// The three nullable background columns, returned by the service for both the
// per-chat pref and the per-user default. The response keeps `string` for the
// preset so it accepts every persisted value.
const BackgroundFields = Schema.Struct({
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
});

const ChatPrefView = Schema.Struct({
  chatJid: Schema.String,
  mutedUntil: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  pinnedAt: Schema.NullOr(Schema.String),
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
  updatedAt: Schema.String,
});

const ListChatPrefsResult = Schema.Struct({
  prefs: Schema.Array(ChatPrefView),
  defaultBackground: BackgroundFields,
});

// A write that lands back on the all-defaults row answers `{ prefs: null }`;
// otherwise the bare pref view.
const PutChatPrefResult = Schema.Union([ChatPrefView, Schema.Struct({ prefs: Schema.Null })]);

const BackgroundDefaultResult = Schema.Struct({ defaultBackground: BackgroundFields });

// `mutedUntil`: an ISO datetime string (a far-future value means "forever"),
// or null to unmute. `pinned`: true stamps now, false clears the pin.
// Background fields: a preset id, or an owned image id plus an optional dim;
// null clears a field. Unknown keys are rejected through the strict payload
// decode, like the other patch-style routes.
const backgroundFieldsShape = {
  backgroundPreset: Schema.optional(Schema.NullOr(BackgroundPreset)),
  backgroundImageId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  ),
  backgroundDim: Schema.optional(
    Schema.NullOr(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(80),
      ),
    ),
  ),
};

const PutChatPrefBody = Schema.Struct({
  mutedUntil: Schema.optional(Schema.NullOr(IsoDateTimeSchema)),
  archived: Schema.optional(Schema.Boolean),
  pinned: Schema.optional(Schema.Boolean),
  ...backgroundFieldsShape,
}).check(
  Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
);

const PutChatBackgroundBody = Schema.Struct(backgroundFieldsShape).check(
  Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
);

// A malformed percent escape is an unknown chat (404), not a server error.
function decodePathJid(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
}

function parseMutedUntil(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'invalid_request', 'mutedUntil must be a valid date and time');
  }
  return date;
}

// Applied to the group so a query or payload decode failure renders like the
// old zod path: a 400 `invalid_request` carrying the first schema message.
class ChatPrefsSchemaErrors extends HttpApiMiddleware.Service<ChatPrefsSchemaErrors>()(
  'zilar/effect/http/ChatPrefsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<ChatPrefsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ChatPrefsSchemaErrors, (error) =>
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

const ChatPrefsGroup = HttpApiGroup.make('chatPrefs')
  .add(
    HttpApiEndpoint.get('list', '/chat-prefs', {
      success: ListChatPrefsResult,
    }),
    HttpApiEndpoint.put('putPref', '/chat-prefs/:chatJid', {
      params: { chatJid: Schema.String },
      payload: PutChatPrefBody,
      success: PutChatPrefResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('getBackground', '/chat-background', {
      success: BackgroundDefaultResult,
    }),
    HttpApiEndpoint.put('putBackground', '/chat-background', {
      payload: PutChatBackgroundBody,
      success: BackgroundDefaultResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(ChatPrefsSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const ChatPrefsApi = HttpApi.make('chatPrefs').add(ChatPrefsGroup);

export interface ChatPrefsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  logger: Logger;
}

export const CHAT_PREFS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/chat-prefs' },
  { method: 'PUT', path: '/api/chat-prefs/:chatJid' },
  { method: 'GET', path: '/api/chat-background' },
  { method: 'PUT', path: '/api/chat-background' },
];

export function createChatPrefsApi(deps: ChatPrefsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = createRateLimiter({
    max: CHAT_PREFS_WRITE_RATE_LIMIT_MAX,
    windowMs: CHAT_PREFS_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(ChatPrefsApi, 'chatPrefs', (handlers) =>
    handlers
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const [prefs, defaultBackground] = yield* Effect.promise(() =>
              Promise.all([
                listChatPrefs(deps.db, user.id),
                getChatBackgroundDefault(deps.db, user.id),
              ]),
            );
            return { prefs, defaultBackground };
          }),
          logger,
          requestId,
        );
      })
      // Partial update of one pref row. The session runs first, then the body
      // is decoded, then access is checked, then the write budget is charged.
      .handle('putPref', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const chatJid = yield* Effect.sync(() => decodePathJid(request.params.chatJid));
            const { bare } = yield* Effect.promise(() =>
              requireChatAccess(deps.db, {
                chatJid,
                userId: user.id,
                domain: deps.config.xmpp.domain,
                mucDomain: deps.config.xmpp.mucDomain,
              }),
            );
            if (!writeLimiter.allow(user.id)) {
              return httpErrorResponse(
                requestId,
                new HttpError(429, 'rate_limited', 'Too many preference changes, try again later'),
              );
            }
            const mutedUntil = yield* Effect.sync(() =>
              parseMutedUntil(request.payload.mutedUntil),
            );
            const pref = yield* Effect.promise(() =>
              putChatPref(deps.db, {
                userId: user.id,
                bare,
                mutedUntil,
                archived: request.payload.archived,
                pinned: request.payload.pinned,
                backgroundPreset: request.payload.backgroundPreset,
                backgroundImageId: request.payload.backgroundImageId,
                backgroundDim: request.payload.backgroundDim,
                now: new Date(now()),
              }),
            );
            // A row back at all defaults is deleted, not kept: the client drops it.
            return pref === null ? { prefs: null } : pref;
          }),
          logger,
          requestId,
        );
      })
      .handle('getBackground', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return {
              defaultBackground: yield* Effect.promise(() =>
                getChatBackgroundDefault(deps.db, user.id),
              ),
            };
          }),
          logger,
          requestId,
        );
      })
      .handle('putBackground', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!writeLimiter.allow(user.id)) {
              return httpErrorResponse(
                requestId,
                new HttpError(429, 'rate_limited', 'Too many preference changes, try again later'),
              );
            }
            const defaultBackground = yield* Effect.promise(() =>
              putChatBackgroundDefault(deps.db, user.id, {
                backgroundPreset: request.payload.backgroundPreset,
                backgroundImageId: request.payload.backgroundImageId,
                backgroundDim: request.payload.backgroundDim,
                now: new Date(now()),
              }),
            );
            return { defaultBackground };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(ChatPrefsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: CHAT_PREFS_API_ROUTES };
}
