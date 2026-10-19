import type { ServerCore } from '../app/deps';
import { Effect, Layer, Result, Schema, SchemaGetter, SchemaIssue } from 'effect';
import { type HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient, SqlError } from 'effect/sql';

import { type AuditRecorder } from '../audit/recorder';

import { type Auth, INVITE_HEADER } from '../auth/auth';
import { createResendMailer, type CurrentMailer, type Mailer } from '../auth/mailer';

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
import { limiter, type RateLimiter } from '../rate-limit';
import {
  deleteMailSettingsEffect,
  needsSetup,
  needsSetupEffect,
  saveMailSettingsEffect,
  settingsCipherFor,
  takeSetupLockEffect,
  getMailSettings,
} from './settings';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_INVITE_MAX_USES,
  DEFAULT_INVITE_TTL_DAYS,
  generateInviteCode,
} from '../auth/invites';
import { firstIssueMessage } from '../effect/schema-issues';
// A pragmatic email check: an address the setup page accepted stays accepted.
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

// Trimmed before the length checks. In effect 4.0.2 the `{ message }` option on
// `isMinLength`/`isMaxLength` does not reach the issue annotations, so one `makeFilter`
// returns each text.
function lengthChecked(field: string, max: number): (value: string) => string | undefined {
  return (value) => {
    if (value.length < 1) {
      return `${field} must not be empty`;
    }
    if (value.length > max) {
      return `${field} must be at most ${max} characters`;
    }
    return undefined;
  };
}

const ResendApiKey = Schema.Trim.pipe(
  Schema.check(Schema.makeFilter(lengthChecked('resendApiKey', 256))),
);

const From = Schema.Trim.pipe(Schema.check(Schema.makeFilter(lengthChecked('from', 320))));

const Lowercased = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

const AdminEmail = Lowercased.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => {
      if (value.length < 1) {
        return 'adminEmail must not be empty';
      }
      if (value.length > 320) {
        return 'adminEmail must be at most 320 characters';
      }
      if (!EMAIL_PATTERN.test(value)) {
        return 'adminEmail must be a valid email address';
      }
      return undefined;
    }),
  ),
);

const SetupBody = Schema.Struct({
  resendApiKey: ResendApiKey,
  from: From,
  adminEmail: AdminEmail,
});

const SetupStatus = Schema.Struct({
  needsSetup: Schema.Boolean,
  mailConfigured: Schema.Boolean,
});

const SetupResult = Schema.Struct({
  ok: Schema.Boolean,
  inviteCode: Schema.String,
});

// The first failure's message: a `makeFilter` text when one is set, else the fallback.
function firstMessage(issue: SchemaIssue.Issue): string | undefined {
  return firstIssueMessage(issue, { firstChildOnly: true });
}

// Explicit `MAIL_TRANSPORT`/`SMTP_*` env means mail is configured without the setup
// screen. Otherwise it is configured when the stored settings exist (read without the
// key, so the secret is never decrypted just to answer the status).
async function mailConfigured(deps: SetupApiDependencies): Promise<boolean> {
  if (deps.config.MAIL_TRANSPORT !== undefined) {
    return true;
  }
  return (await getMailSettings(deps.db, settingsCipherFor(deps.config))) !== null;
}

// Inserted in the setup transaction so it commits atomically with the settings; same
// single-use, 7-day shape as a bootstrap invite.
function createSetupInvite(): Effect.Effect<
  string,
  HttpError | SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = new Date();
    const code = generateInviteCode();
    const rows = yield* sql<{ code: string }>`INSERT INTO invites
      (id, code, created_by, created_at, expires_at, max_uses, uses)
      VALUES (${randomUUID()}, ${code}, ${null}, ${now},
        ${new Date(now.getTime() + DEFAULT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)},
        ${DEFAULT_INVITE_MAX_USES}, ${0})
      RETURNING code`;
    const invite = rows[0];
    if (invite === undefined) {
      return yield* Effect.fail(new HttpError(500, 'internal_error', 'Setup failed, try again'));
    }
    return invite.code;
  });
}

// Mints a real OTP through the auth server (so the sign-in flow accepts it) and sends it.
// The setup invite header lets the unknown email through the pre-sign-up hook. Any
// failure surfaces as a delivery error, mapped to 422 with no provider detail.
async function sendSetupTestCode(input: {
  auth: Auth;
  mailer: Mailer;
  email: string;
  inviteCode: string;
}): Promise<void> {
  const otp = await input.auth.api.createVerificationOTP({
    body: { email: input.email, type: 'sign-in' },
    headers: new Headers({ [INVITE_HEADER]: input.inviteCode }),
  });
  await input.mailer.sendOtp(input.email, otp, 'sign-in');
}

export interface SetupApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  mailer: CurrentMailer;
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
  const setupLimiter = deps.limiter ?? limiter('setup');
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
            if (!setupLimiter.allow(clientIp(request.request))) {
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
