// Integration settings helpers: rate-limit constants, dependencies, the per-request bot
// token resolver and shared helpers. Every route needs a session, and a non-owner gets the
// same 404 as an unknown route, so existence never leaks.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { TelegramClient } from '../stickers/telegram/set';
import type { Auth } from '../auth/auth';
import type { CurrentMailer, Mailer } from '../auth/mailer';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { getMailSettings, settingsCipherFor } from '../setup/settings';
import type { createSettingsCipher } from '../setup/crypto';

// Instance-level secrets the owner manages from Settings → Integrations, sealed with the
// envelope cipher; env variables still win when set. The owner is the user with the
// earliest `createdAt` (there is no global admin role), and everyone else gets the same
// 404 as an unknown route.

const TELEGRAM_BOT_TOKEN_SETTING = 'telegram.bot_token';

type Decrypter = Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>;
type Encrypter = Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>;

interface StoredValueRow {
  value: string;
}

async function getStoredTelegramToken(
  db: ServerDatabase,
  cipher: Decrypter,
): Promise<string | null> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StoredValueRow>`SELECT value FROM instance_settings WHERE key = ${TELEGRAM_BOT_TOKEN_SETTING}`;
    }),
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return cipher.decrypt(row.value);
}

async function saveStoredTelegramToken(
  db: ServerDatabase,
  cipher: Encrypter,
  token: string,
): Promise<void> {
  const value = cipher.encrypt(token);
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`INSERT INTO instance_settings (key, value)
        VALUES (${TELEGRAM_BOT_TOKEN_SETTING}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }),
  );
}

async function deleteStoredTelegramToken(db: ServerDatabase): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`DELETE FROM instance_settings WHERE key = ${TELEGRAM_BOT_TOKEN_SETTING}`;
    }),
  );
}
export const INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX = 10;
export const INTEGRATIONS_TELEGRAM_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const INTEGRATIONS_EMAIL_RATE_LIMIT_MAX = 5;
export const INTEGRATIONS_EMAIL_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface IntegrationsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  mailer: CurrentMailer;
  audit?: AuditRecorder;
  createTelegram?: (token: string) => TelegramClient;
  telegramLimiter?: RateLimiter | undefined;
  emailLimiter?: RateLimiter | undefined;
  now?: (() => number) | undefined;
  sendTestMail?: ((input: { mailer: Mailer; email: string }) => Promise<void>) | undefined;
  swapMailer?: ((mailer: Mailer) => void) | undefined;
}

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

export type IntegrationSource = 'env' | 'stored' | null;

export interface BotTokenResolverDeps {
  config: Pick<ServerConfig, 'TELEGRAM_BOT_TOKEN'>;
  db: ServerDatabase;
  cipher: { decrypt: (envelope: string) => string };
  logger?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined;
}

// The env value wins when set, else the stored value, else none. Read per request so
// saving works without a restart. A decryption failure reads as "no token".
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

// Telegram answers a bad bot token with 401 whatever the method; only owner-gated
// verification reports it distinctly.
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

// Explicit `MAIL_TRANSPORT`/`SMTP_*` env means mail is configured without the settings page.
export function envMailConfigured(config: ServerConfig): boolean {
  return config.MAIL_TRANSPORT !== undefined;
}

// A broken envelope reads as "not stored"; the status answer never carries the secret.
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
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ email: string }>`SELECT email FROM "user" WHERE id = ${userId} LIMIT 1`;
    }),
  );
  if (row === undefined) {
    throw notFound();
  }
  return row.email;
}

// The production test send: a short message to the signed-in owner through the candidate
// mailer. No secret in the body; a delivery failure maps to 422 `mail_send_failed`.
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
