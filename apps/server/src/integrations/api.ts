// Integrations module on the Effect `HttpApi` adapter (T-0544): the same
// methods, paths, statuses, bodies, limiter order, audit calls and texts as
// the deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). These routes carry secrets (the Telegram
// bot token, the Resend key); like before, no secret reaches a response, a
// log line or an error text. Helpers stay in `routes.ts`.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import { createResendMailer } from '../auth/mailer';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
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
import { sqlRuntimeFor } from '../effect/sql';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { getMailSettings, saveMailSettingsEffect, settingsCipherFor } from '../setup/settings';
import { createTelegramClient } from '../stickers/telegram-import';
import { voiceTranscriptionStatusFor } from '../voice-transcription/routes';
import {
  INTEGRATIONS_EMAIL_RATE_LIMIT_MAX,
  INTEGRATIONS_EMAIL_RATE_LIMIT_WINDOW_MS,
  INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX,
  INTEGRATIONS_TELEGRAM_RATE_LIMIT_WINDOW_MS,
  deleteStoredTelegramToken,
  envMailConfigured,
  isInvalidToken,
  isMailbox,
  isOwner,
  mailStatusFor,
  notFound,
  ownerEmailFor,
  saveStoredTelegramToken,
  sendWorkingTestMail,
  telegramStatusFor,
  type IntegrationsRoutesDependencies,
} from './routes';

// Replaces `telegramBodySchema` (zod): trimmed before the length and
// no-spaces checks, strict via the endpoint's `PayloadParseOptions`.
const TelegramBody = Schema.Struct({
  botToken: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(256),
      Schema.makeFilter((value) =>
        /\s/.test(value) ? 'botToken must not contain spaces' : undefined,
      ),
    ),
  ),
});

// Replaces `emailBodySchema` (zod): `from` is a bare address or a display
// name plus angle-addr; `resendApiKey` changes the key only when given.
const EmailBody = Schema.Struct({
  from: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(320),
      Schema.makeFilter((value) =>
        /[\r\n]/.test(value) ? 'from must be a valid sender address' : undefined,
      ),
      Schema.makeFilter((value) =>
        isMailbox(value) ? undefined : 'from must be a valid sender address',
      ),
    ),
  ),
  resendApiKey: Schema.optional(
    Schema.Trim.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  ),
});

const IntegrationSource = Schema.NullOr(Schema.Literals(['env', 'stored']));

const TelegramStatus = Schema.Struct({
  configured: Schema.Boolean,
  source: IntegrationSource,
});

const EmailStatus = Schema.Struct({
  configured: Schema.Boolean,
  source: IntegrationSource,
  from: Schema.NullOr(Schema.String),
});

const VoiceTranscriptionStatus = Schema.Struct({
  configured: Schema.Boolean,
  baseUrl: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
});

const IntegrationsView = Schema.Struct({
  telegram: TelegramStatus,
  email: EmailStatus,
  voiceTranscription: VoiceTranscriptionStatus,
  canManage: Schema.Boolean,
});

const OkResult = Schema.Struct({ ok: Schema.Boolean });

// Applied to the group so a payload decode failure renders like the old zod
// path: 400 `invalid_request` carrying the first schema message.
class IntegrationsSchemaErrors extends HttpApiMiddleware.Service<IntegrationsSchemaErrors>()(
  'zilar/effect/http/IntegrationsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<IntegrationsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(IntegrationsSchemaErrors, (error) =>
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

// Runs the Telegram save budget before the payload is decoded, exactly like
// the old route's `requireOwner` -> `allow` -> decode order: the owner check
// runs first (a non-owner gets the same 404 as an unknown route without
// spending budget), then the limiter, then the decode. `requires:
// CurrentUser` is satisfied by `Session`.
class IntegrationsTelegramRateLimit extends HttpApiMiddleware.Service<
  IntegrationsTelegramRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/IntegrationsTelegramRateLimit') {}

function telegramRateLimitLayer(
  limiter: RateLimiter,
  db: ServerDatabase,
): Layer.Layer<IntegrationsTelegramRateLimit> {
  return Layer.succeed(
    IntegrationsTelegramRateLimit,
    IntegrationsTelegramRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        const owned = yield* Effect.promise(() => isOwner(db, user.id));
        if (!owned) {
          return httpErrorResponse(requestId, notFound());
        }
        if (!limiter.allow(user.id)) {
          return httpErrorResponse(
            requestId,
            new HttpError(429, 'rate_limited', 'Too many attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

// Same order as the old email route: owner (404) -> env guard (409) ->
// limiter (429) -> decode. The env guard lives here (before the decode)
// because the middleware runs before the payload is parsed.
class IntegrationsEmailRateLimit extends HttpApiMiddleware.Service<
  IntegrationsEmailRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/IntegrationsEmailRateLimit') {}

function emailRateLimitLayer(
  limiter: RateLimiter,
  db: ServerDatabase,
  config: ServerConfig,
): Layer.Layer<IntegrationsEmailRateLimit> {
  return Layer.succeed(
    IntegrationsEmailRateLimit,
    IntegrationsEmailRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        const owned = yield* Effect.promise(() => isOwner(db, user.id));
        if (!owned) {
          return httpErrorResponse(requestId, notFound());
        }
        if (envMailConfigured(config)) {
          return httpErrorResponse(
            requestId,
            new HttpError(
              409,
              'managed_by_environment',
              'Email is managed by environment variables on this server',
            ),
          );
        }
        if (!limiter.allow(user.id)) {
          return httpErrorResponse(
            requestId,
            new HttpError(429, 'rate_limited', 'Too many attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const IntegrationsGroup = HttpApiGroup.make('integrations')
  .add(
    HttpApiEndpoint.get('status', '/settings/integrations', {
      success: IntegrationsView,
    }),
    HttpApiEndpoint.put('setTelegram', '/settings/integrations/telegram', {
      payload: TelegramBody,
      success: OkResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(IntegrationsTelegramRateLimit),
    HttpApiEndpoint.delete('removeTelegram', '/settings/integrations/telegram', {
      success: OkResult,
    }),
    HttpApiEndpoint.put('setEmail', '/settings/integrations/email', {
      payload: EmailBody,
      success: OkResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(IntegrationsEmailRateLimit),
  )
  .middleware(Session)
  .middleware(IntegrationsSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const IntegrationsApi = HttpApi.make('integrations').add(IntegrationsGroup);

export const INTEGRATIONS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/settings/integrations' },
  { method: 'PUT', path: '/api/settings/integrations/telegram' },
  { method: 'DELETE', path: '/api/settings/integrations/telegram' },
  { method: 'PUT', path: '/api/settings/integrations/email' },
];

export function createIntegrationsApi(deps: IntegrationsRoutesDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const telegramLimiter =
    deps.telegramLimiter ??
    createRateLimiter({
      max: INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX,
      windowMs: INTEGRATIONS_TELEGRAM_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const emailLimiter =
    deps.emailLimiter ??
    createRateLimiter({
      max: INTEGRATIONS_EMAIL_RATE_LIMIT_MAX,
      windowMs: INTEGRATIONS_EMAIL_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const buildTelegram = deps.createTelegram ?? ((token: string) => createTelegramClient(token));
  const sendTestMail = deps.sendTestMail ?? sendWorkingTestMail;
  const swap = deps.swapMailer ?? ((mailer) => deps.mailer.use(mailer));

  async function requireOwner(userId: string): Promise<void> {
    if (!(await isOwner(deps.db, userId))) {
      throw notFound();
    }
  }

  const groupLayer = HttpApiBuilder.group(IntegrationsApi, 'integrations', (handlers) =>
    handlers
      // Owner-only like the three writes: anyone else gets the same 404 as
      // an unknown route. The web reads "am I the owner" from 200 versus
      // 404 (`useIsServerOwner`).
      .handle('status', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() => requireOwner(user.id));
            const [telegram, email, voiceTranscription] = yield* Effect.promise(() =>
              Promise.all([
                telegramStatusFor(deps),
                mailStatusFor(deps),
                voiceTranscriptionStatusFor(deps.db, deps.config, deps.logger),
              ]),
            );
            return { telegram, email, voiceTranscription, canManage: true };
          }),
          logger,
          requestId,
        );
      })
      // The Telegram token, verified through `getMe` before storing. The
      // limiter middleware already charged the budget, before the payload
      // decode. A rejected token answers 422 `invalid_token` and nothing is
      // stored; anything else failing to reach Telegram answers 503.
      .handle('setTelegram', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() => requireOwner(user.id));
            const botToken = request.payload.botToken;
            const client = buildTelegram(botToken);
            yield* Effect.promise(() => client.getMe()).pipe(
              Effect.catchDefect((defect) => {
                if (isInvalidToken(defect)) {
                  return Effect.die(
                    new HttpError(
                      422,
                      'invalid_token',
                      'Telegram rejected the bot token. Check it and try again.',
                    ),
                  );
                }
                return Effect.die(
                  new HttpError(503, 'try_later', 'Could not reach Telegram, try again later'),
                );
              }),
            );
            const cipher = settingsCipherFor(deps.config);
            yield* Effect.promise(() => saveStoredTelegramToken(deps.db, cipher, botToken));
            void deps.audit?.record({
              actorUserId: user.id,
              aiId: null,
              groupId: null,
              action: 'integrations.telegram_set',
              subjectId: null,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
            return { ok: true };
          }),
          logger,
          requestId,
        );
      })
      // Removes the stored token. An env token cannot be deleted here and
      // stays in effect.
      .handle('removeTelegram', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() => requireOwner(user.id));
            yield* Effect.promise(() => deleteStoredTelegramToken(deps.db));
            void deps.audit?.record({
              actorUserId: user.id,
              aiId: null,
              groupId: null,
              action: 'integrations.telegram_removed',
              subjectId: null,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
            return { ok: true };
          }),
          logger,
          requestId,
        );
      })
      // The sender changes always; the key changes only when given. Before
      // storing anything a real test message goes to the owner's own email
      // through the candidate mailer; a failed send answers 422
      // `mail_send_failed` and nothing is stored. The env guard and the
      // limiter middleware already ran, before the payload decode.
      .handle('setEmail', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() => requireOwner(user.id));
            if (envMailConfigured(deps.config)) {
              throw new HttpError(
                409,
                'managed_by_environment',
                'Email is managed by environment variables on this server',
              );
            }
            const { from, resendApiKey } = request.payload;
            const cipher = settingsCipherFor(deps.config);
            let key: string | null = null;
            if (resendApiKey !== undefined) {
              key = resendApiKey;
            } else {
              const stored = yield* Effect.promise(() => getMailSettings(deps.db, cipher));
              key = stored?.resendApiKey ?? null;
            }
            if (key === null) {
              throw new HttpError(
                422,
                'mail_send_failed',
                'The test email could not be sent. Check the Resend key and the sender address.',
              );
            }
            const candidate = createResendMailer(deps.config, deps.logger, {
              resendApiKey: key,
              from,
            });
            const ownerEmail = yield* Effect.promise(() => ownerEmailFor(deps.db, user.id));
            yield* Effect.promise(() =>
              sendTestMail({ mailer: candidate, email: ownerEmail }),
            ).pipe(
              // Nothing is stored on a failed send: same fixed message as
              // setup, with no provider detail and no secret.
              Effect.catchDefect(() =>
                Effect.die(
                  new HttpError(
                    422,
                    'mail_send_failed',
                    'The test email could not be sent. Check the Resend key and the sender address.',
                  ),
                ),
              ),
            );
            const storedKey: string = key;
            yield* Effect.promise(() =>
              sqlRuntimeFor(deps.db).runPromise(
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient;
                  return yield* sql.withTransaction(
                    saveMailSettingsEffect(cipher, { resendApiKey: storedKey, from }),
                  );
                }),
              ),
            );
            swap(candidate);
            void deps.audit?.record({
              actorUserId: user.id,
              aiId: null,
              groupId: null,
              action: 'integrations.email_set',
              subjectId: null,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
            return { ok: true };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(IntegrationsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(telegramRateLimitLayer(telegramLimiter, deps.db)),
    Layer.provide(emailRateLimitLayer(emailLimiter, deps.db, deps.config)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: INTEGRATIONS_API_ROUTES };
}
