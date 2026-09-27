import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import * as schema from '../db/schema';
import { consumeInvite } from './invites';
import type { Mailer } from './mailer';

export const INVITE_HEADER = 'x-galena-invite';
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 10 * 60;
export const OTP_ALLOWED_ATTEMPTS = 5;

export interface CreateAuthInput {
  db: ServerDatabase;
  config: ServerConfig;
  mailer: Mailer;
}

export function createAuth({ db, config, mailer }: CreateAuthInput) {
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
    advanced: {
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
        async sendVerificationOTP({ email, otp, type }) {
          await mailer.sendOtp(email, otp, type);
        },
      }),
      bearer(),
    ],
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
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
