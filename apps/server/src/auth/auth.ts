import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import * as schema from '../db/schema';
import { setUpContactsFromInvite } from '../contacts/service';
import { ensureXmppAccount } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { consumeInvite, findUsableInvite } from './invites';
import type { Mailer } from './mailer';

export const INVITE_HEADER = 'x-zilar-invite';
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 10 * 60;
export const OTP_ALLOWED_ATTEMPTS = 5;

const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
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

export function createAuth({
  db,
  config,
  mailer,
  adminClient,
  logger,
}: CreateAuthInput & { logger?: AuthLogger }) {
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
    trustedOrigins: config.WEB_ORIGINS,
    rateLimit: {
      enabled: true,
      storage: 'memory',
      customRules: {
        [SEND_OTP_PATH]: { window: RATE_LIMIT_WINDOW_SECONDS, max: 3 },
        '/sign-in/email-otp': { window: RATE_LIMIT_WINDOW_SECONDS, max: 10 },
        '/email-otp/check-verification-otp': { window: RATE_LIMIT_WINDOW_SECONDS, max: 10 },
        '/email-otp/verify-email': { window: RATE_LIMIT_WINDOW_SECONDS, max: 10 },
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
        async sendVerificationOTP({ email, otp, type }) {
          await mailer.sendOtp(email, otp, type);
        },
      }),
      bearer(),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_OTP_PATH) {
          return;
        }

        const rawEmail = ctx.body?.email;
        if (typeof rawEmail !== 'string' || rawEmail.length === 0) {
          return;
        }

        const email = rawEmail.toLowerCase();
        const existingUser = await ctx.context.internalAdapter.findUserByEmail(email);
        if (existingUser) {
          return;
        }

        const code = ctx.headers?.get(INVITE_HEADER)?.trim();
        const invite = code ? await findUsableInvite(db, code) : null;
        if (invite) {
          return;
        }

        return ctx.json({ success: true });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const code = context?.headers?.get(INVITE_HEADER)?.trim();
            if (!code) {
              throw new APIError('BAD_REQUEST', {
                message: 'An invite is required to create an account.',
              });
            }
            const invite = await consumeInvite(db, code);
            if (!invite) {
              throw new APIError('BAD_REQUEST', {
                message: 'This invite is invalid, expired or already used.',
              });
            }
            return { data: user };
          },
          after: async (user, context) => {
            // The XMPP account is created here, but its failure must never block
            // sign-up: the token endpoint provisions lazily on the next request.
            try {
              await ensureXmppAccount(db, adminClient, user.id, config.xmpp.domain);
            } catch (error) {
              logger?.warn(
                { userId: user.id, err: error },
                'could not provision the XMPP account on sign-up',
              );
            }

            // Contacts from the invite: record which invite created the user
            // and, when the inviter is known, make them contacts and add the
            // two roster items. Roster failures are retried on the token
            // endpoint, so they must never block sign-up.
            const inviteCode = context?.headers?.get(INVITE_HEADER)?.trim();
            if (inviteCode) {
              try {
                await setUpContactsFromInvite(db, adminClient, config.xmpp.domain, {
                  userId: user.id,
                  inviteCode,
                });
              } catch (error) {
                logger?.warn(
                  { userId: user.id, err: error },
                  'could not set up contacts on sign-up',
                );
              }
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
