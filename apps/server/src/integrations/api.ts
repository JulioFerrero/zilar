// Integrations module on the Effect `HttpApi` adapter (T-0544): the same
// methods, paths, statuses, bodies, limiter order, audit calls and texts as
// the deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). These routes carry secrets (the Telegram
// bot token, the Resend key); like before, no secret reaches a response, a
// log line or an error text. Helpers stay in `routes.ts`.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import {
  CurrentUser,
  IntegrationsEmailRateLimit,
  IntegrationsGroup,
  IntegrationsTelegramRateLimit,
} from '@zilar/api-contract';
import { createResendMailer } from '../auth/mailer';
import { contractSchemaErrorLayer } from '../auth/schema-errors';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
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
  isOwner,
  mailStatusFor,
  notFound,
  ownerEmailFor,
  saveStoredTelegramToken,
  sendWorkingTestMail,
  telegramStatusFor,
  type IntegrationsRoutesDependencies,
} from './routes';

const MAIL_SEND_FAILED =
  'The test email could not be sent. Check the Resend key and the sender address.';

// Runs the Telegram save budget before the payload is decoded, exactly like
// the old route's `requireOwner` -> `allow` -> decode order: the owner check
// runs first (a non-owner gets the same 404 as an unknown route without
// spending budget), then the limiter, then the decode. `requires:
// CurrentUser` is satisfied by `Session`.
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

const IntegrationsApi = HttpApi.make('integrations').add(IntegrationsGroup);

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

  function recordAudit(userId: string, action: string): void {
    void deps.audit?.record({
      actorUserId: userId,
      aiId: null,
      groupId: null,
      action,
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
  }

  const groupLayer = HttpApiBuilder.group(IntegrationsApi, 'integrations', (handlers) =>
    handlers
      // Owner-only like the three writes: anyone else gets the same 404 as
      // an unknown route. The web reads "am I the owner" from 200 versus
      // 404 (`useIsServerOwner`).
      .handle(
        'status',
        handler(logger, async (_request, user) => {
          await requireOwner(user.id);
          const [telegram, email, voiceTranscription] = await Promise.all([
            telegramStatusFor(deps),
            mailStatusFor(deps),
            voiceTranscriptionStatusFor(deps.db, deps.config, deps.logger),
          ]);
          return { telegram, email, voiceTranscription, canManage: true };
        }),
      )
      // The Telegram token, verified through `getMe` before storing. The
      // limiter middleware already charged the budget, before the payload
      // decode. A rejected token answers 422 `invalid_token` and nothing is
      // stored; anything else failing to reach Telegram answers 503.
      .handle(
        'setTelegram',
        handler(logger, async (request, user) => {
          await requireOwner(user.id);
          const botToken = request.payload.botToken;
          const client = buildTelegram(botToken);
          try {
            await client.getMe();
          } catch (defect) {
            if (isInvalidToken(defect)) {
              throw new HttpError(
                422,
                'invalid_token',
                'Telegram rejected the bot token. Check it and try again.',
              );
            }
            throw new HttpError(503, 'try_later', 'Could not reach Telegram, try again later');
          }
          await saveStoredTelegramToken(deps.db, settingsCipherFor(deps.config), botToken);
          recordAudit(user.id, 'integrations.telegram_set');
          return { ok: true };
        }),
      )
      // Removes the stored token. An env token cannot be deleted here and
      // stays in effect.
      .handle(
        'removeTelegram',
        handler(logger, async (_request, user) => {
          await requireOwner(user.id);
          await deleteStoredTelegramToken(deps.db);
          recordAudit(user.id, 'integrations.telegram_removed');
          return { ok: true };
        }),
      )
      // The sender changes always; the key changes only when given. Before
      // storing anything a real test message goes to the owner's own email
      // through the candidate mailer; a failed send answers 422
      // `mail_send_failed` and nothing is stored. The env guard and the
      // limiter middleware already ran, before the payload decode.
      .handle(
        'setEmail',
        handler(logger, async (request, user) => {
          await requireOwner(user.id);
          if (envMailConfigured(deps.config)) {
            throw new HttpError(
              409,
              'managed_by_environment',
              'Email is managed by environment variables on this server',
            );
          }
          const { from, resendApiKey } = request.payload;
          const cipher = settingsCipherFor(deps.config);
          const key =
            resendApiKey ?? (await getMailSettings(deps.db, cipher))?.resendApiKey ?? null;
          if (key === null) {
            throw new HttpError(422, 'mail_send_failed', MAIL_SEND_FAILED);
          }
          const candidate = createResendMailer(deps.config, deps.logger, {
            resendApiKey: key,
            from,
          });
          const ownerEmail = await ownerEmailFor(deps.db, user.id);
          try {
            await sendTestMail({ mailer: candidate, email: ownerEmail });
          } catch {
            // Nothing is stored on a failed send: same fixed message as
            // setup, with no provider detail and no secret.
            throw new HttpError(422, 'mail_send_failed', MAIL_SEND_FAILED);
          }
          await runSql(
            deps.db,
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              return yield* sql.withTransaction(
                saveMailSettingsEffect(cipher, { resendApiKey: key, from }),
              );
            }),
          );
          swap(candidate);
          recordAudit(user.id, 'integrations.email_set');
          return { ok: true };
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(IntegrationsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(telegramRateLimitLayer(telegramLimiter, deps.db)),
    Layer.provide(emailRateLimitLayer(emailLimiter, deps.db, deps.config)),
    Layer.provide(contractSchemaErrorLayer(logger)),
  );

  return mountApi(IntegrationsApi, apiLayer);
}
