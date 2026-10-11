// First-run setup on the Effect `HttpApi` adapter (T-0578): the same
// methods, paths, statuses, bodies, step order and texts as the router it
// replaces. `app.ts` mounts this API at the same position.
//
// Both transactions run on `effect/sql` (`sql.withTransaction` inside a
// `runSql` on the registered runtime), through the effects in
// `setup/settings.ts`; the older versions are gone in T-0675.
//
// The body is decoded manually inside the POST handler (Effect Schema, same
// trims, lowercase, bounds, email rule and texts as the old zod schema), so
// the route keeps its exact order: `needsSetup` 404 -> limiter 429 -> decode
// 400 -> transaction -> test send -> mailer swap -> audit.

import { Effect, Layer, Result, Schema } from 'effect';
import type { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { createResendMailer, type CurrentMailer, type Mailer } from '../auth/mailer';
import type { ServerConfig } from '../config';
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
  /** The live mailer, swapped to the stored Resend transport on success. */
  mailer: CurrentMailer;
  logger: Logger;
  audit?: AuditRecorder;
  /** Overrides the per-IP setup limiter (tests inject a small budget). */
  limiter?: RateLimiter | undefined;
  /** Injected in tests; production trusts proxy hops like the join limiter. */
  getClientIp?: ((request: HttpServerRequest.HttpServerRequest) => string) | undefined;
  /** Injected in tests; production trusts TRUSTED_PROXY_HOPS like the join limiter. */
  trustedProxyHops?: number | undefined;
  /** Sends the test code through the new mailer; tests inject a fake. */
  sendTestCode?:
    | ((input: { auth: Auth; mailer: Mailer; email: string; inviteCode: string }) => Promise<void>)
    | undefined;
  /**
   * Swaps the live mailer after the test send succeeds; tests inject a
   * capture. Defaults to swapping the shared `mailer` above.
   */
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
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
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
  // Same client-IP rule as the join limiter: with N trusted proxy hops
  // the Nth address from the right of `x-forwarded-for` counts, otherwise
  // the socket address — behind Coolify every visitor must not share one
  // budget. Tests inject `getClientIp`.
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
            // Setup-done first: once an admin exists every caller gets the same
            // 404 as an unknown route, never a 429.
            if (!(yield* Effect.promise(() => needsSetup(deps.db)))) {
              throw notFound();
            }
            if (!limiter.allow(clientIp(request.request))) {
              throw new HttpError(429, 'rate_limited', 'Too many setup attempts, try again later');
            }
            // Mirrors `c.req.json().catch(() => null)`: an unparseable or empty
            // body is `null`, which fails the struct decode below.
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
                      // Re-check inside the lock: a concurrent setup (or a
                      // sign-up racing the check above) must not create a
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
                        // Roll back the settings AND the invite only while
                        // setup is still open (no user signed up in the
                        // meantime). Never delete on a concurrent success:
                        // both rows belong to the finished setup then.
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
                // The cleanup must never mask the specified answer or leak
                // provider detail: one line with the error name, then 422 below.
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

            // The key works: swap the live mailer without a restart.
            swap(candidate);

            // Ids only: never the email, the key or the invite code. The recorder
            // swallows write failures itself, so this never fails the request.
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
