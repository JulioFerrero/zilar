// Integration settings helpers (T-0162 + the Email follow-up). The routes
// themselves live on the Effect `HttpApi` adapter in `./api.ts`; this module
// keeps the rate-limit constants, the dependencies, the per-request bot token
// resolver the import route uses, and the shared helpers the handlers call.
// The server owner — the user with the earliest `createdAt` (there is no
// global admin role) — manages the integration keys from Settings →
// Integrations. Every route needs a session, and anyone who is not the owner
// gets the same 404 as an unknown route, so existence is never leaked.

import { asc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { CurrentMailer, Mailer } from '../auth/mailer';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { user } from '../db/schema';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { getMailSettings, settingsCipherFor, type SetupTransaction } from '../setup/settings';
import type { TelegramClient } from '../stickers/telegram-import';
import {
  deleteStoredTelegramToken,
  saveStoredTelegramToken,
  getStoredTelegramToken,
  TELEGRAM_BOT_TOKEN_SETTING,
} from './settings';

export const INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX = 10;
export const INTEGRATIONS_TELEGRAM_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const INTEGRATIONS_EMAIL_RATE_LIMIT_MAX = 5;
export const INTEGRATIONS_EMAIL_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export function isMailbox(value: string): boolean {
  const trimmed = value.trim();
  const angle = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (angle?.[2] ?? trimmed).trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(address);
}

export interface IntegrationsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** The live mailer, swapped to the new Resend transport on email success. */
  mailer: CurrentMailer;
  audit?: AuditRecorder;
  /** Builds the Telegram client; tests inject a fake so no network is hit. */
  createTelegram?: (token: string) => TelegramClient;
  /** Overrides the per-user Telegram limiter (tests inject a small budget). */
  telegramLimiter?: RateLimiter | undefined;
  /** Overrides the per-user email limiter (tests inject a small budget). */
  emailLimiter?: RateLimiter | undefined;
  /** Injected in tests; production trusts TRUSTED_PROXY_HOPS like join. */
  now?: (() => number) | undefined;
  /**
   * Sends the verification test message through the candidate mailer;
   * tests inject a fake. Defaults to a short "it works" message to the
   * owner's own address (a code is not needed — the owner is signed in).
   */
  sendTestMail?: ((input: { mailer: Mailer; email: string }) => Promise<void>) | undefined;
  /**
   * Swaps the live mailer after the test send succeeds; tests inject a
   * capture. Defaults to swapping the shared `mailer` above.
   */
  swapMailer?: ((mailer: Mailer) => void) | undefined;
}

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

// The server owner is the user with the earliest `createdAt`: there is no
// global admin role, so the first account to exist owns the integrations.
export async function isOwner(db: ServerDatabase, userId: string): Promise<boolean> {
  const [first] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt), asc(user.id))
    .limit(1);
  return first !== undefined && first.id === userId;
}

export type IntegrationSource = 'env' | 'stored' | null;

export interface BotTokenResolverDeps {
  config: Pick<ServerConfig, 'TELEGRAM_BOT_TOKEN'>;
  db: ServerDatabase;
  cipher: { decrypt: (envelope: string) => string };
  /** Warned (never with a secret) when a stored token cannot be decrypted. */
  logger?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined;
}

// The token for a request: the env value wins when set, else the stored
// value, else none. Read per request (not at boot) so saving works without
// a restart. A decryption failure reads as "no token", never as an error
// carrying the secret.
export function createGetBotToken(deps: BotTokenResolverDeps): () => Promise<string | null> {
  return async () => {
    const env = deps.config.TELEGRAM_BOT_TOKEN;
    if (env !== undefined && env !== '') {
      return env;
    }
    try {
      return await getStoredTelegramToken(deps.db, deps.cipher);
    } catch {
      deps.logger?.warn(
        {},
        'the stored Telegram token could not be decrypted; check ZILAR_KEY_ENCRYPTION_KEY',
      );
      return null;
    }
  };
}

// Telegram answers a bad bot token with 401 `Unauthorized`, whatever the
// method — including the imports' `getStickerSet`. Only the owner-gated
// verification path reports it distinctly; the import flow still reads any
// non-pack failure as `try_later` (its tests assert exactly that).
export function isInvalidToken(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'invalid_token'
  );
}

export async function telegramStatusFor(
  deps: IntegrationsRoutesDependencies,
): Promise<{ configured: boolean; source: IntegrationSource }> {
  const env = deps.config.TELEGRAM_BOT_TOKEN;
  if (env !== undefined && env !== '') {
    return { configured: true, source: 'env' };
  }
  const stored = await readStoredTokenQuietly(deps);
  return stored === null
    ? { configured: false, source: null }
    : { configured: true, source: 'stored' };
}

export async function mailStatusFor(deps: IntegrationsRoutesDependencies): Promise<{
  configured: boolean;
  source: IntegrationSource;
  from: string | null;
}> {
  if (envMailConfigured(deps.config)) {
    return { configured: true, source: 'env', from: deps.config.MAIL_FROM ?? null };
  }
  const stored = await readStoredMailQuietly(deps);
  if (stored === null) {
    return { configured: false, source: null, from: null };
  }
  return { configured: true, source: 'stored', from: stored.from };
}

// Explicit `MAIL_TRANSPORT`/`SMTP_*` env means mail is configured without
// the settings page (mirrors the setup route's rule).
export function envMailConfigured(config: ServerConfig): boolean {
  return config.MAIL_TRANSPORT !== undefined;
}

// The stored token/key is decrypted for the status call; a broken envelope
// reads as "not stored". The status answer never carries the secret either
// way — only `configured` and `source`.
async function readStoredTokenQuietly(
  deps: IntegrationsRoutesDependencies,
): Promise<string | null> {
  try {
    return await getStoredTelegramToken(deps.db, settingsCipherFor(deps.config));
  } catch {
    return null;
  }
}

async function readStoredMailQuietly(
  deps: IntegrationsRoutesDependencies,
): Promise<{ resendApiKey: string; from: string } | null> {
  try {
    return await getMailSettings(deps.db, settingsCipherFor(deps.config));
  } catch {
    return null;
  }
}

export async function ownerEmailFor(db: ServerDatabase, userId: string): Promise<string> {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (row === undefined) {
    throw notFound();
  }
  return row.email;
}

// The production test send for email changes: a short "it works" message
// to the signed-in owner's own address through the candidate mailer. The
// body carries no secret; any delivery failure surfaces as a rejection the
// caller maps to 422 `mail_send_failed`.
export async function sendWorkingTestMail(input: { mailer: Mailer; email: string }): Promise<void> {
  const { mailer, email } = input;
  if (typeof (mailer as { sendTestMail?: unknown }).sendTestMail === 'function') {
    await (mailer as unknown as { sendTestMail: (email: string) => Promise<void> }).sendTestMail(
      email,
    );
    return;
  }
  await mailer.sendOtp(email, '000000', 'email-verification');
}

export { TELEGRAM_BOT_TOKEN_SETTING };
export { deleteStoredTelegramToken, saveStoredTelegramToken };
export type { SetupTransaction };
