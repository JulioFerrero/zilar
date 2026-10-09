// First-run setup on the Effect `HttpApi` adapter (T-0578): the same
// methods, paths, statuses, bodies, step order and texts as the Hono router
// it replaces. `app.ts` mounts this API at the same position.
//
// Both transactions run on `effect/sql` (`sql.withTransaction` inside a
// `runSql` on the registered runtime), through the effects in
// `setup/settings.ts`; the drizzle versions are gone in T-0675.
//
// The body is decoded manually inside the POST handler (Effect Schema, same
// trims, lowercase, bounds, email rule and texts as the old zod schema), so
// the route keeps its exact order: `needsSetup` 404 -> limiter 429 -> decode
// 400 -> transaction -> test send -> mailer swap -> audit.

import { randomUUID } from 'node:crypto';
import { Effect, Layer, Result, Schema, SchemaGetter, SchemaIssue } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient, SqlError } from 'effect/sql';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { INVITE_HEADER } from '../auth/auth';
import {
  DEFAULT_INVITE_MAX_USES,
  DEFAULT_INVITE_TTL_DAYS,
  generateInviteCode,
} from '../auth/invites';
import { createResendMailer, type CurrentMailer, type Mailer } from '../auth/mailer';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import {
  requestIdOf,
  socketAddressOf,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { clientIpFrom } from '../http/client-ip';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  deleteMailSettingsEffect,
  getMailSettings,
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

// Every setup query runs on the `effect/sql` client registered for this
// database (see `../effect/sql`). A rejection here is a defect for the caller,
// exactly like the drizzle `db.transaction` rejection it replaces.
function runSql<A, E>(
  db: SetupApiDependencies['db'],
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// zod v4's practical email check (`z.email()`), kept so an address the setup
// page accepted before is still accepted.
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

// Replaces `field: z.string().trim().min(1, ...).max(n, ...)`: trimmed before
// the length checks, exactly like the old chain. In effect 4.0.2 the
// `{ message }` option on `isMinLength`/`isMaxLength` does not reach the issue
// annotations, so one `makeFilter` returns each text (T-0561 pitfall).
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

// Replaces `z.string().trim().toLowerCase()`: trimmed, then lowercased, before
// the checks below run.
const Lowercased = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

// Replaces the `adminEmail` chain: trim, lowercase, min 1, max 320, then the
// email rule, with the same texts in the same order.
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

// The first failure's message, like zod's `issues[0].message`: a `makeFilter`
// text when the failing check set one, else the generic fallback. A returned
// string from a `makeFilter` predicate becomes the `message` annotation of its
// inner `InvalidValue` issue.
function firstMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite': {
      const first = issue.issues[0];
      return first === undefined ? undefined : firstMessage(first);
    }
    case 'Pointer':
    case 'Encoding':
    case 'Filter':
      return firstMessage(issue.issue);
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
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
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const SetupApi = HttpApi.make('setup').add(SetupGroup);

export const SETUP_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/setup/status' },
  { method: 'POST', path: '/api/setup' },
];

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

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: SETUP_API_ROUTES };
}

// Env-based SMTP installs behave exactly as before: explicit
// `MAIL_TRANSPORT`/`SMTP_*` env means mail is configured without the
// setup screen. Otherwise mail is configured exactly when the setup
// screen's stored settings exist (read here without the key, so the
// secret is never decrypted just to answer the status).
async function mailConfigured(deps: SetupApiDependencies): Promise<boolean> {
  if (deps.config.MAIL_TRANSPORT !== undefined) {
    return true;
  }
  return (await getMailSettings(deps.db, settingsCipherFor(deps.config))) !== null;
}

// Inserts the first-admin invite directly: the setup transaction must commit
// it atomically with the settings above. Same single-use, 7-day shape as a
// bootstrap invite (see `auth/invites.ts`).
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

// Sends the test sign-in code to the admin email through the new mailer:
// mints a real OTP with the auth server's own API (so the code the admin
// receives is the code the sign-in flow accepts), then delivers it. The
// request carries the setup invite header so the pre-sign-up hook lets
// the unknown email through exactly like the web client's sign-up will.
// Any failure (bad key, bad sender) surfaces as a delivery error the
// caller maps to 422 `mail_send_failed` with no provider detail.
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
