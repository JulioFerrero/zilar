// Step order: `needsSetup` 404, limiter 429, decode 400, transaction, test send, mailer
// swap, audit.

import { Effect, Layer, Result, Schema } from 'effect';
import type { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { Auth } from '../auth/auth';
import { createResendMailer, type CurrentMailer, type Mailer } from '../auth/mailer';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import {
  mountApi,
  requestIdOf,
  socketAddressOf,
  withErrorEnvelope,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { clientIpFrom } from '../http/client-ip';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { createSetupInvite, mailConfigured, sendSetupTestCode } from './mail';
import { SetupBody, SetupStatus, SetupResult, firstMessage } from './schema';
import {
  deleteMailSettingsEffect,
  needsSetup,
  needsSetupEffect,
  saveMailSettingsEffect,
  settingsCipherFor,
  takeSetupLockEffect,
} from './settings';

export const SETUP_RATE_LIMIT_MAX = 5;
export const SETUP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface SetupApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  mailer: CurrentMailer;
  logger: Logger;
  audit?: AuditRecorder;
  limiter?: RateLimiter | undefined;
  getClientIp?: ((request: HttpServerRequest.HttpServerRequest) => string) | undefined;
  trustedProxyHops?: number | undefined;
  sendTestCode?:
    | ((input: { auth: Auth; mailer: Mailer; email: string; inviteCode: string }) => Promise<void>)
    | undefined;
  swapMailer?: ((mailer: Mailer) => void) | undefined;
}

const SetupGroup = HttpApiGroup.make('setup')
  .add(
    HttpApiEndpoint.get('status', '/setup/status', {
      success: SetupStatus,
    }),
    HttpApiEndpoint.post('run', '/setup', {
      success: SetupResult,
    }),
  )
  .prefix('/api');

const SetupApi = HttpApi.make('setup').add(SetupGroup);

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

export function createSetupApi(deps: SetupApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const limiter =
    deps.limiter ??
    createRateLimiter({ max: SETUP_RATE_LIMIT_MAX, windowMs: SETUP_RATE_LIMIT_WINDOW_MS });
  // Same client-IP rule as the join limiter: behind Coolify every visitor must not share
  // one budget.
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

  const groupLayer = HttpApiBuilder.group(SetupApi, 'setup', (handlers) =>
    handlers
      .handle('status', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            if (!(yield* Effect.promise(() => needsSetup(deps.db)))) {
              return { needsSetup: false, mailConfigured: true };
            }
            return {
              needsSetup: true,
              mailConfigured: yield* Effect.promise(() => mailConfigured(deps)),
            };
          }),
          logger,
          requestId,
        );
      })
      .handle('run', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            // Setup-done first: once an admin exists every caller gets a 404, never a 429.
            if (!(yield* Effect.promise(() => needsSetup(deps.db)))) {
              throw notFound();
            }
            if (!limiter.allow(clientIp(request.request))) {
              throw new HttpError(429, 'rate_limited', 'Too many setup attempts, try again later');
            }
            // An unparseable or empty body is `null`, which fails the struct decode below.
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(null)),
            );
            const decoded = Schema.decodeUnknownResult(SetupBody)(raw);
            if (Result.isFailure(decoded)) {
              throw new HttpError(
                400,
                'invalid_request',
                firstMessage(decoded.failure.issue) ?? 'Invalid request',
              );
            }
            const { resendApiKey, from, adminEmail } = decoded.success;

            const cipher = settingsCipherFor(deps.config);
            let inviteCode: string | null = null;
            const stored = yield* Effect.promise(() =>
              runSql(
                deps.db,
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient;
                  yield* sql.withTransaction(
                    Effect.gen(function* () {
                      yield* takeSetupLockEffect();
                      // Re-check inside the lock: a concurrent setup must not create a
                      // second invite.
                      if (yield* needsSetupEffect()) {
                        yield* saveMailSettingsEffect(cipher, { resendApiKey, from });
                        inviteCode = yield* createSetupInvite();
                      }
                    }),
                  );
                }),
              ),
            ).pipe(
              Effect.map((value) => ({ ok: true as const, value })),
              Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
            );
            if (!stored.ok) {
              if (stored.defect instanceof HttpError) {
                throw stored.defect;
              }
              throw new HttpError(500, 'internal_error', 'Setup failed, try again');
            }
            if (inviteCode === null) {
              // A concurrent setup finished first: same 404 as a finished setup.
              throw notFound();
            }

            const code: string = inviteCode;
            const candidate = createResendMailer(deps.config, deps.logger, {
              resendApiKey,
              from,
            });
            const send = deps.sendTestCode ?? sendSetupTestCode;
            const swap = deps.swapMailer ?? ((mailer: Mailer): void => deps.mailer.use(mailer));
            const sent = yield* Effect.promise(() =>
              send({
                auth: deps.auth,
                mailer: candidate,
                email: adminEmail,
                inviteCode: code,
              }),
            ).pipe(
              Effect.map((value) => ({ ok: true as const, value })),
              Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
            );
            if (!sent.ok) {
              const rolledBack = yield* Effect.promise(() =>
                runSql(
                  deps.db,
                  Effect.gen(function* () {
                    const sql = yield* SqlClient.SqlClient;
                    yield* sql.withTransaction(
                      Effect.gen(function* () {
                        yield* takeSetupLockEffect();
                        // Roll back settings AND invite only while setup is still open;
                        // both rows belong to a finished setup on concurrent success.
                        if (yield* needsSetupEffect()) {
                          yield* deleteMailSettingsEffect();
                          yield* sql`DELETE FROM invites WHERE code = ${code}`;
                        }
                      }),
                    );
                  }),
                ),
              ).pipe(
                Effect.map((value) => ({ ok: true as const, value })),
                Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
              );
              if (!rolledBack.ok) {
                // One line with the error name, then 422: never provider detail.
                const rollbackError = rolledBack.defect;
                deps.logger.warn(
                  {
                    errName: rollbackError instanceof Error ? rollbackError.name : 'unknown',
                  },
                  'setup rollback failed after a failed test email',
                );
              }
              throw new HttpError(
                422,
                'mail_send_failed',
                'The test email could not be sent. Check the Resend key and the sender address.',
              );
            }

            swap(candidate);

            // Ids only: never the email, the key or the invite code.
            void deps.audit?.record({
              actorUserId: null,
              aiId: null,
              groupId: null,
              action: 'setup.completed',
              subjectId: null,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });

            return { ok: true, inviteCode: code };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(SetupApi).pipe(Layer.provide(groupLayer));

  return mountApi(SetupApi, apiLayer);
}
