// Pins module on the Effect `HttpApi` adapter (T-0525): the same methods,
// paths, limiter order, statuses and bodies as the deleted Hono router
// (`routes.ts`), mounted under Hono by `apps/server/src/effect/http.ts`.
// Handlers keep calling the drizzle service; the DB rewrite is a separate lane.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
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
  PIN_MESSAGE_ID_MAX,
  PIN_SENDER_NAME_MAX,
  PIN_TEXT_MAX,
  listPins,
  pinMessage,
  unpinMessage,
  type PinsServiceDeps,
} from './service';

export const PINS_WRITE_RATE_LIMIT_MAX = 60;
export const PINS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;
// Message bodies may carry tab and newline (Shift+Enter); the snapshot keeps
// the same rule and rejects every other control character.
const SNAPSHOT_WHITESPACE = new Set(['\t', '\n']);

function hasControlCharacters(value: string, allowWhitespace = false): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      if (allowWhitespace && SNAPSHOT_WHITESPACE.has(char)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

const PinKind = Schema.Literals(['text', 'image', 'file', 'voice', 'card']);

// Replaces `listQuerySchema` (zod): one required `chat` string; strict, so an
// excess key is a 400 like the old `.strict()`.
const ListPinsQuery = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
});

// Replaces `createPinBodySchema` (zod). `senderName` is trimmed before the
// length and control-character checks, exactly like the old `.trim()`.
const CreatePinBody = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  messageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(PIN_MESSAGE_ID_MAX)),
  senderName: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PIN_SENDER_NAME_MAX),
    Schema.makeFilter((value) =>
      hasControlCharacters(value) ? 'senderName must not contain control characters' : undefined,
    ),
  ),
  text: Schema.optional(
    Schema.String.check(
      Schema.isMaxLength(PIN_TEXT_MAX),
      Schema.makeFilter((value) =>
        hasControlCharacters(value, true) ? 'text must not contain control characters' : undefined,
      ),
    ),
  ),
  kind: Schema.optional(PinKind),
});

const PinView = Schema.Struct({
  id: Schema.String,
  chat: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  text: Schema.String,
  kind: PinKind,
  pinnedBy: Schema.String,
  pinnedAt: Schema.String,
});

const PinList = Schema.Struct({ pins: Schema.Array(PinView) });

// Applied to the group so a query or payload decode failure renders like the
// old zod path: 400 `invalid_request`. No test asserts the exact text, so the
// Effect Schema message is used (the old text was the first zod issue).
class PinsSchemaErrors extends HttpApiMiddleware.Service<PinsSchemaErrors>()(
  'zilar/effect/http/PinsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<PinsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(PinsSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

// Runs the write budget before the payload is decoded, exactly like the old
// POST/DELETE routes' `writeLimiter.allow` -> decode order: an invalid body
// still spends budget. `requires: CurrentUser` is satisfied by `Session`.
class PinsWriteRateLimit extends HttpApiMiddleware.Service<
  PinsWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/PinsWriteRateLimit') {}

function writeRateLimitLayer(limiter: RateLimiter): Layer.Layer<PinsWriteRateLimit> {
  return Layer.succeed(
    PinsWriteRateLimit,
    PinsWriteRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many pins, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const PinsGroup = HttpApiGroup.make('pins')
  .add(
    HttpApiEndpoint.get('list', '/pins', {
      query: ListPinsQuery,
      success: PinList,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.post('create', '/pins', {
      payload: CreatePinBody,
      success: PinView,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(PinsWriteRateLimit),
    HttpApiEndpoint.delete('remove', '/pins/:id', {
      params: { id: Schema.String },
      success: PinView,
    }).middleware(PinsWriteRateLimit),
  )
  .middleware(Session)
  .middleware(PinsSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const PinsApi = HttpApi.make('pins').add(PinsGroup);

export interface PinsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  audit?: AuditRecorder;
  logger: Logger;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  writeLimiter?: RateLimiter;
}

export const PINS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/pins' },
  { method: 'POST', path: '/api/pins' },
  { method: 'DELETE', path: '/api/pins/:id' },
];

export function createPinsApi(deps: PinsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const writeLimiter =
    deps.writeLimiter ??
    createRateLimiter({
      max: PINS_WRITE_RATE_LIMIT_MAX,
      windowMs: PINS_WRITE_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });

  function serviceDeps(): PinsServiceDeps {
    return {
      db: deps.db,
      domain: deps.config.xmpp.domain,
      mucDomain: deps.config.xmpp.mucDomain,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(PinsApi, 'pins', (handlers) =>
    handlers
      // The pinned messages of one chat, newest first.
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const pins = yield* Effect.promise(() =>
              listPins(serviceDeps(), request.query.chat, user.id),
            );
            return { pins };
          }),
          logger,
          requestId,
        );
      })
      // Pins one message. The write budget was already charged, before the
      // payload decode.
      .handle('create', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const pin = yield* Effect.promise(() =>
              pinMessage(serviceDeps(), { ...request.payload, actorId: user.id }),
            );
            return HttpServerResponse.jsonUnsafe(pin, { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      // Unpins one message. The write budget was already charged.
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
              unpinMessage(serviceDeps(), request.params.id, user.id),
            );
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(PinsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(writeRateLimitLayer(writeLimiter)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: PINS_API_ROUTES };
}
