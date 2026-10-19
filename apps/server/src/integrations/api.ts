// These routes carry secrets (the Telegram bot token, the Resend key): no secret reaches
// a response, a log line or an error text.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import {
  CurrentUser,
  IntegrationsEmailRateLimit,
  IntegrationsGroup,
  IntegrationsTelegramRateLimit,
} from '@zilar/api-contract';
import { createResendMailer } from '../auth/mailer';
import type { ServerConfig } from '../config/load';
import { createTelegramClient } from '../stickers/telegram/client';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  mountGroups,
  handler,
  httpErrorResponse,
  requestIdOf,
  type EffectApiMount,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
import { limiter, type RateLimiter } from '../rate-limit';
import { isInstanceOwner } from '../setup/instance-owner';
import { getMailSettings, saveMailSettingsEffect, settingsCipherFor } from '../setup/settings';
import { voiceTranscriptionStatusFor } from '../voice-transcription/routes';
import {
  deleteStoredTelegramToken,
  envMailConfigured,
  isInvalidToken,
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

// The owner check runs first (a non-owner gets the same 404 without spending budget),
// then the limiter, then the payload decode.
function telegramRateLimitLayer(
  limiter: RateLimiter,
  db: ServerDatabase,
  logger: Logger,
): Layer.Layer<IntegrationsTelegramRateLimit> {
  return Layer.succeed(
    IntegrationsTelegramRateLimit,
    IntegrationsTelegramRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        const owned = yield* Effect.promise(() => isInstanceOwner(db, user.id, logger));
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

// Owner (404), env guard (409), limiter (429), decode: the guard runs before the decode
// because the middleware runs before the payload is parsed.
function emailRateLimitLayer(
  limiter: RateLimiter,
  db: ServerDatabase,
  config: ServerConfig,
  logger: Logger,
): Layer.Layer<IntegrationsEmailRateLimit> {
  return Layer.succeed(
    IntegrationsEmailRateLimit,
    IntegrationsEmailRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        const owned = yield* Effect.promise(() => isInstanceOwner(db, user.id, logger));
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
  const telegramLimiter = deps.telegramLimiter ?? limiter('integrationsTelegram', now);
  const emailLimiter = deps.emailLimiter ?? limiter('integrationsEmail', now);
  const buildTelegram = deps.createTelegram ?? ((token: string) => createTelegramClient(token));
  const sendTestMail = deps.sendTestMail ?? sendWorkingTestMail;
  const swap = deps.swapMailer ?? ((mailer) => deps.mailer.use(mailer));

  async function requireOwner(userId: string): Promise<void> {
    if (!(await isInstanceOwner(deps.db, userId, logger))) {
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
      // Owner-only: anyone else gets the same 404 as an unknown route.
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
      // The token is verified through `getMe` before storing; a rejected token answers 422
      // `invalid_token` and nothing is stored.
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
      // An env token cannot be deleted here and stays in effect.
      .handle(
        'removeTelegram',
        handler(logger, async (_request, user) => {
          await requireOwner(user.id);
          await deleteStoredTelegramToken(deps.db);
          recordAudit(user.id, 'integrations.telegram_removed');
          return { ok: true };
        }),
      )
      // The sender always changes, the key only when given. A real test message goes to the
      // owner's own email through the candidate mailer; a failed send answers 422 and stores
      // nothing.
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
            // Nothing is stored on a failed send: fixed message, no provider detail or secret.
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

  return mountGroups(IntegrationsApi, groupLayer, {
    auth: deps.auth,
    logger,
    extra: [
      telegramRateLimitLayer(telegramLimiter, deps.db, logger),
      emailRateLimitLayer(emailLimiter, deps.db, deps.config, logger),
    ],
    schemaErrors: true,
  });
}
