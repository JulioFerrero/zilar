import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import { Cause, Effect } from 'effect';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { setUpContactsFromInvite } from '../contacts/service';
import { ensureXmppAccount } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { consumeInvite, findUsableInvite } from './invites';
import type { Mailer } from './mailer';
import { isTransportConfigured, MailNotConfiguredError } from './mailer';
import { effectSqlAdapter } from './sql-adapter';

export const INVITE_HEADER = 'x-zilar-invite';
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 10 * 60;
export const OTP_ALLOWED_ATTEMPTS = 5;

export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
// Asking for a code: 3 per minute, so a typo or a resend never locks a
// household out for ten minutes. Guessing a code stays capped separately.
const SEND_OTP_WINDOW_SECONDS = 60;
const SEND_OTP_PATH = '/email-otp/send-verification-otp';

export interface CreateAuthInput {
  db: ServerDatabase;
  config: ServerConfig;
  mailer: Mailer;
  adminClient: EjabberdAdminClient;
}

// Minimal slice of pino's Logger we need; the server passes its own logger.
export interface AuthLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

const isMailNotConfigured = (error: unknown): error is MailNotConfiguredError =>
  error instanceof MailNotConfiguredError;

const mailNotConfiguredError = () =>
  new APIError(503, {
    code: 'mail_not_configured',
    message: 'Email is not configured. Finish the server setup first.',
  });

// Sign-up must never fail because a follow-up step did: log the cause as an
// object (so redaction applies) and carry on.
const warnAndContinue =
  (logger: AuthLogger | undefined, userId: string, message: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger?.warn({ userId, err: Cause.squash(cause) }, message);
        }),
      ),
    );

export function createAuth({
  db,
  config,
  mailer,
  adminClient,
  logger,
}: CreateAuthInput & { logger?: AuthLogger }) {
  const profileVersions = new Map<string, number>();
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: effectSqlAdapter(db),
    emailAndPassword: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
    trustedOrigins: config.WEB_ORIGINS,
    rateLimit: {
      enabled: true,
      storage: 'memory',
      customRules: {
        [SEND_OTP_PATH]: { window: SEND_OTP_WINDOW_SECONDS, max: 3 },
        '/sign-in/email-otp': { window: RATE_LIMIT_WINDOW_SECONDS, max: 10 },
        '/email-otp/check-verification-otp': { window: RATE_LIMIT_WINDOW_SECONDS, max: 10 },
        '/email-otp/verify-email': { window: RATE_LIMIT_WINDOW_SECONDS, max: 10 },
      },
    },
    session: {
      // T-0858: a signed `session_data` cookie lets a browser request skip the
      // session and user reads for 5 minutes. Sign-out clears it on the device;
      // a session revoked elsewhere may stay valid here for up to 5 minutes.
      // Mobile sends only a bearer token, so it still reads the database.
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_SECONDS,
        // A profile update bumps the user's version, so a cache cookie that
        // still holds the old user is dropped and the next read hits the
        // database (PATCH /api/me re-reads the session right after updating).
        version: (_session, user) => String(profileVersions.get(user.id) ?? 0),
      },
    },
    advanced: {
      // Better Auth skips origin checks in test environments by default; keep
      // them on everywhere so the WEB_ORIGINS trust list is always enforced.
      disableOriginCheck: false,
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
      },
    },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        storeOTP: 'hashed',
        sendVerificationOTP: ({ email, otp, type }) =>
          Effect.runPromise(
            Effect.tryPromise({
              try: () => mailer.sendOtp(email, otp, type),
              catch: (error) => error,
            }).pipe(
              Effect.catchIf(isMailNotConfigured, () => Effect.fail(mailNotConfiguredError())),
            ),
          ),
      }),
      bearer(),
    ],
    hooks: {
      before: createAuthMiddleware((ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            if (ctx.path !== SEND_OTP_PATH) {
              return;
            }

            // No transport can send while unconfigured (T-0161): fail every
            // code request loudly with 503 `mail_not_configured` instead of
            // the fake success below. Uniform for every email, so nothing
            // about accounts leaks.
            if (!isTransportConfigured(mailer)) {
              return yield* Effect.fail(mailNotConfiguredError());
            }

            const rawEmail = ctx.body?.email;
            if (typeof rawEmail !== 'string' || rawEmail.length === 0) {
              return;
            }

            const email = rawEmail.toLowerCase();
            const existingUser = yield* Effect.promise(() =>
              ctx.context.internalAdapter.findUserByEmail(email),
            );
            if (existingUser) {
              return;
            }

            const code = ctx.headers?.get(INVITE_HEADER)?.trim();
            const invite = code ? yield* Effect.promise(() => findUsableInvite(db, code)) : null;
            if (invite) {
              return;
            }

            return ctx.json({ success: true });
          }),
        ),
      ),
    },
    databaseHooks: {
      user: {
        update: {
          after: (user) => {
            profileVersions.set(user.id, (profileVersions.get(user.id) ?? 0) + 1);
            return Promise.resolve();
          },
        },
        create: {
          before: (user, context) =>
            Effect.runPromise(
              Effect.gen(function* () {
                const code = context?.headers?.get(INVITE_HEADER)?.trim();
                if (!code) {
                  return yield* Effect.fail(
                    new APIError('BAD_REQUEST', {
                      message: 'An invite is required to create an account.',
                    }),
                  );
                }
                const invite = yield* Effect.promise(() => consumeInvite(db, code));
                if (!invite) {
                  return yield* Effect.fail(
                    new APIError('BAD_REQUEST', {
                      message: 'This invite is invalid, expired or already used.',
                    }),
                  );
                }
                return { data: user };
              }),
            ),
          after: (user, context) =>
            Effect.runPromise(
              Effect.gen(function* () {
                // The XMPP account is created here, but its failure must never block
                // sign-up: the token endpoint provisions lazily on the next request.
                yield* Effect.promise(() =>
                  ensureXmppAccount(db, adminClient, user.id, config.xmpp.domain),
                ).pipe(
                  warnAndContinue(
                    logger,
                    user.id,
                    'could not provision the XMPP account on sign-up',
                  ),
                );

                // Contacts from the invite: record which invite created the user
                // and, when the inviter is known, make them contacts and add the
                // two roster items. Roster failures are retried on the token
                // endpoint, so they must never block sign-up.
                const inviteCode = context?.headers?.get(INVITE_HEADER)?.trim();
                if (inviteCode) {
                  yield* Effect.promise(() =>
                    setUpContactsFromInvite(db, adminClient, config.xmpp.domain, {
                      userId: user.id,
                      inviteCode,
                    }),
                  ).pipe(warnAndContinue(logger, user.id, 'could not set up contacts on sign-up'));
                }
              }),
            ),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
