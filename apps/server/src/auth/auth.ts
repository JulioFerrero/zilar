import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import { Cause, Effect } from 'effect';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { setUpContactsFromInvite } from '../contacts/service';
import { ensureXmppAccount } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { CLIENT_IP_HEADER } from '../http/client-ip';
import { findUsableInvite } from './invites';
import { cancelDeletionOnSignIn } from './deletion-request';
import type { Mailer } from './mailer';
import { isTransportConfigured, MailNotConfiguredError } from './mailer';
import { endXmppSessions, SIGNED_OUT_SESSION_KICK_REASON } from './sessions';
import { effectSqlAdapter } from './sql-adapter';

export const INVITE_HEADER = 'x-zilar-invite';
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 10 * 60;
export const OTP_ALLOWED_ATTEMPTS = 5;

export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
// 3 per minute, so a typo or resend never locks a household out; code guessing stays capped separately.
const SEND_OTP_WINDOW_SECONDS = 60;
const SEND_OTP_PATH = '/email-otp/send-verification-otp';

export interface CreateAuthInput {
  db: ServerDatabase;
  config: ServerConfig;
  mailer: Mailer;
  adminClient: EjabberdAdminClient;
}

// Minimal slice of pino's Logger: `error` for audit-write logs, the rest only warns.
export interface AuthLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

const isMailNotConfigured = (error: unknown): error is MailNotConfiguredError =>
  error instanceof MailNotConfiguredError;

const mailNotConfiguredError = () =>
  new APIError(503, {
    code: 'mail_not_configured',
    message: 'Email is not configured. Finish the server setup first.',
  });

// A follow-up failure is logged as an object (so redaction applies) and never fails sign-up.
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
  // The invite code of an in-flight sign-up, keyed by the lowercased email, handed to the SQL adapter.
  const pendingInviteCodes = new Map<string, string>();
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: effectSqlAdapter(db, pendingInviteCodes),
    emailAndPassword: { enabled: false },
    telemetry: { enabled: false },
    // Better Auth's own logging is disabled, so forward `warn`/`error` to the server logger; only a formatted message arrives, never a request body.
    logger: {
      log: (level, message) => {
        if (level === 'error') {
          logger?.error({}, message);
        } else if (level === 'warn') {
          logger?.warn({}, message);
        }
      },
    },
    trustedOrigins: config.WEB_ORIGINS,
    // These two Better Auth routes are replaced: `/list-sessions` leaks tokens and `/update-user` skips the profile rules.
    disabledPaths: ['/list-sessions', '/update-user'],
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
      // A signed `session_data` cookie lets a browser skip reads for 5 minutes; a session revoked elsewhere may stay valid that long.
      // Mobile sends only a bearer token, so it still reads the database.
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_SECONDS,
        // A profile update bumps the user's version, so a cache cookie with the old user is dropped.
        version: (_session, user) => String(profileVersions.get(user.id) ?? 0),
      },
    },
    advanced: {
      // Better Auth skips origin checks in tests; keep them on so the WEB_ORIGINS trust list is always enforced.
      disableOriginCheck: false,
      // Read only the edge-resolved IP from TRUSTED_PROXY_HOPS, which overwrites any client-supplied value.
      ipAddress: {
        ipAddressHeaders: [CLIENT_IP_HEADER],
      },
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

            // With no transport every code request fails loudly with 503 `mail_not_configured`.
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

            // Answer plainly when an email has no account and no invite, so the app can ask for an invite code; Julio accepted that this reveals whether an email has an account.
            const code = ctx.headers?.get(INVITE_HEADER)?.trim();
            if (!code) {
              return yield* Effect.fail(
                new APIError(403, {
                  code: 'invite_required',
                  message: 'This email has no account yet. Enter your invite code to sign up.',
                }),
              );
            }

            const invite = yield* Effect.promise(() => findUsableInvite(db, code));
            if (!invite) {
              return yield* Effect.fail(
                new APIError(400, {
                  code: 'invite_invalid',
                  message: 'This invite code is invalid, expired or already used.',
                }),
              );
            }
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
          // `before` validates the invite; the SQL adapter consumes it in the same transaction as the insert, so a failed insert never burns it and racing sign-ups cannot exceed the cap.
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
                const invite = yield* Effect.promise(() => findUsableInvite(db, code));
                if (!invite) {
                  return yield* Effect.fail(
                    new APIError('BAD_REQUEST', {
                      message: 'This invite is invalid, expired or already used.',
                    }),
                  );
                }
                pendingInviteCodes.set(user.email, code);
                return { data: user };
              }),
            ),
          after: (user, context) =>
            Effect.runPromise(
              Effect.gen(function* () {
                // XMPP provisioning must never block sign-up: the token endpoint provisions lazily.
                yield* Effect.promise(() =>
                  ensureXmppAccount(db, adminClient, user.id, config.xmpp.domain),
                ).pipe(
                  warnAndContinue(
                    logger,
                    user.id,
                    'could not provision the XMPP account on sign-up',
                  ),
                );

                const inviteCode = context?.headers?.get(INVITE_HEADER)?.trim();
                if (inviteCode) {
                  // Roster failures are retried on the token endpoint and must never block sign-up.
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
      // Signing in cancels a pending account deletion; best effort, never blocks sign-in.
      session: {
        create: {
          after: (session) => cancelDeletionOnSignIn(db, logger, session.userId),
        },
        // A deleted session row closes the user's XMPP streams at once; ejabberd kicks all devices, so they reconnect with fresh tokens.
        // Expired rows deleted by the get-session path are not a sign-out and must not kick.
        delete: {
          after: async (session) => {
            if (session.expiresAt.getTime() <= Date.now()) {
              return;
            }
            await endXmppSessions(
              adminClient,
              logger,
              session.userId,
              SIGNED_OUT_SESSION_KICK_REASON,
            );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
