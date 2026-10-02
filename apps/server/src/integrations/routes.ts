// Integration settings routes (T-0162 + the Email follow-up). The server
// owner — the user with the earliest `createdAt` (there is no global admin
// role) — manages the integration keys from Settings → Integrations. Every
// route needs a session, and anyone who is not the owner gets the same 404
// as an unknown route, so existence is never leaked.
//
// - `GET /api/settings/integrations` → `{ telegram: { configured, source },
//   email: { configured, source, from }, canManage }`. Secrets never: the
//   bot token and the Resend key are not returned, not even masked. The
//   sender address is not a secret and is returned. Like the three writes,
//   a non-owner gets the same 404 as an unknown route; the web reads "am I
//   the owner" from 200 versus 404 (`useIsServerOwner`).
// - `PUT /api/settings/integrations/telegram` body `{ botToken }`: the
//   token is verified through Telegram's `getMe` (the injectable client)
//   before storing; a rejected token answers 422 `invalid_token` and
//   nothing is stored.
// - `DELETE /api/settings/integrations/telegram` removes the stored token.
//   An env token cannot be deleted here and stays in effect.
// - `PUT /api/settings/integrations/email` body `{ from, resendApiKey? }`:
//   the sender changes always; the key changes only when given. Before
//   storing anything a real test message goes to the owner's own email
//   through the candidate mailer; a failed send answers 422
//   `mail_send_failed` and nothing is stored. While mail comes from env the
//   PUT answers 409 `managed_by_environment`; there is no DELETE (removing
//   mail would lock everyone out).
//
// The Telegram importer and the live mailer read the new values without a
// restart: the import route resolves the token per request through
// `getBotToken`, and a successful email PUT swaps the `CurrentMailer`.

import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { createResendMailer, type CurrentMailer, type Mailer } from '../auth/mailer';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { user } from '../db/schema';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  getMailSettings,
  saveMailSettings,
  settingsCipherFor,
  type SetupTransaction,
} from '../setup/settings';
import { createTelegramClient, type TelegramClient } from '../stickers/telegram-import';
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

const telegramBodySchema = z
  .object({
    botToken: z
      .string()
      .trim()
      .min(1, { message: 'botToken must not be empty' })
      .max(256, { message: 'botToken must be at most 256 characters' })
      .refine((value) => !/\s/.test(value), { message: 'botToken must not contain spaces' }),
  })
  .strict();

// Same shape as the setup route's sender: a bare address or a display name
// plus angle-addr (the Resend verifier needs a domain, not a bare word).
const fromSchema = z
  .string()
  .trim()
  .min(1, { message: 'from must not be empty' })
  .max(320, { message: 'from must be at most 320 characters' })
  .refine((value) => !/[\r\n]/.test(value), { message: 'from must be a valid sender address' })
  .refine((value) => isMailbox(value), { message: 'from must be a valid sender address' });

const emailBodySchema = z
  .object({
    from: fromSchema,
    resendApiKey: z
      .string()
      .trim()
      .min(1, { message: 'resendApiKey must not be empty' })
      .max(256, { message: 'resendApiKey must be at most 256 characters' })
      .optional(),
  })
  .strict();

function isMailbox(value: string): boolean {
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

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

// The server owner is the user with the earliest `createdAt`: there is no
// global admin role, so the first account to exist owns the integrations.
async function isOwner(db: ServerDatabase, userId: string): Promise<boolean> {
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
      return null;
    }
  };
}

export function createIntegrationsRoutes(deps: IntegrationsRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const telegramLimiter =
    deps.telegramLimiter ??
    createRateLimiter({
      max: INTEGRATIONS_TELEGRAM_RATE_LIMIT_MAX,
      windowMs: INTEGRATIONS_TELEGRAM_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const emailLimiter =
    deps.emailLimiter ??
    createRateLimiter({
      max: INTEGRATIONS_EMAIL_RATE_LIMIT_MAX,
      windowMs: INTEGRATIONS_EMAIL_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const buildTelegram = deps.createTelegram ?? ((token: string) => createTelegramClient(token));
  const sendTestMail = deps.sendTestMail ?? sendWorkingTestMail;
  const swap = deps.swapMailer ?? ((mailer: Mailer): void => deps.mailer.use(mailer));

  async function requireOwner(userId: string): Promise<void> {
    if (!(await isOwner(deps.db, userId))) {
      throw notFound();
    }
  }

  function telegramStatus(): Promise<{ configured: boolean; source: IntegrationSource }> {
    return telegramStatusFor(deps);
  }

  function mailStatus(): Promise<{
    configured: boolean;
    source: IntegrationSource;
    from: string | null;
  }> {
    return mailStatusFor(deps);
  }

  routes.get('/settings/integrations', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    // Owner-only like the three writes: anyone else gets the same 404 as
    // an unknown route. The web reads "am I the owner" from 200 versus
    // 404 (`useIsServerOwner`).
    await requireOwner(caller.id);
    const [telegram, email] = await Promise.all([telegramStatus(), mailStatus()]);
    return c.json({ telegram, email, canManage: true });
  });

  routes.put('/settings/integrations/telegram', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    await requireOwner(caller.id);
    if (!telegramLimiter.allow(caller.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = telegramBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { botToken } = parsed.data;

    // Verify before storing: a `getMe` with the candidate token answers
    // `ok` exactly when Telegram accepts it. A rejected token answers 422
    // `invalid_token` and nothing is stored; anything else failing to reach
    // Telegram answers 503 `try_later`.
    const client = buildTelegram(botToken);
    try {
      await client.getMe();
    } catch (error) {
      if (isInvalidToken(error)) {
        throw new HttpError(
          422,
          'invalid_token',
          'Telegram rejected the bot token. Check it and try again.',
        );
      }
      throw new HttpError(503, 'try_later', 'Could not reach Telegram, try again later');
    }

    const cipher = settingsCipherFor(deps.config);
    await deps.db.transaction(async (tx: SetupTransaction) => {
      await saveStoredTelegramToken(tx, cipher, botToken);
    });

    void deps.audit?.record({
      actorUserId: caller.id,
      aiId: null,
      groupId: null,
      action: 'integrations.telegram_set',
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
    return c.json({ ok: true });
  });

  routes.delete('/settings/integrations/telegram', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    await requireOwner(caller.id);
    if (!telegramLimiter.allow(caller.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    await deps.db.transaction(async (tx: SetupTransaction) => {
      await deleteStoredTelegramToken(tx);
    });
    // An env token cannot be deleted here and stays in effect; the status
    // call after this answers from env when one is set.
    void deps.audit?.record({
      actorUserId: caller.id,
      aiId: null,
      groupId: null,
      action: 'integrations.telegram_removed',
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
    return c.json({ ok: true });
  });

  routes.put('/settings/integrations/email', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    await requireOwner(caller.id);
    if (envMailConfigured(deps.config)) {
      throw new HttpError(
        409,
        'managed_by_environment',
        'Email is managed by environment variables on this server',
      );
    }
    if (!emailLimiter.allow(caller.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = emailBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { from, resendApiKey } = parsed.data;

    // The key when one is given, else the stored key (sender-only change).
    // Without any key the sender cannot send, so fail before the test mail.
    const cipher = settingsCipherFor(deps.config);
    let key: string | null = null;
    if (resendApiKey !== undefined) {
      key = resendApiKey;
    } else {
      key = (await getMailSettings(deps.db, cipher))?.resendApiKey ?? null;
    }
    if (key === null) {
      throw new HttpError(
        422,
        'mail_send_failed',
        'The test email could not be sent. Check the Resend key and the sender address.',
      );
    }

    const candidate = createResendMailer(deps.config, deps.logger, { resendApiKey: key, from });
    const ownerEmail = await ownerEmailFor(deps.db, caller.id);
    try {
      await sendTestMail({ mailer: candidate, email: ownerEmail });
    } catch {
      // Nothing is stored on a failed send: same fixed message as setup,
      // with no provider detail and no secret.
      throw new HttpError(
        422,
        'mail_send_failed',
        'The test email could not be sent. Check the Resend key and the sender address.',
      );
    }

    await deps.db.transaction(async (tx: SetupTransaction) => {
      await saveMailSettings(tx, cipher, { resendApiKey: key as string, from });
    });
    swap(candidate);

    void deps.audit?.record({
      actorUserId: caller.id,
      aiId: null,
      groupId: null,
      action: 'integrations.email_set',
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
    return c.json({ ok: true });
  });

  return routes;
}

// Telegram answers a bad bot token with 401 `Unauthorized`, whatever the
// method — including the imports' `getStickerSet`. Only the owner-gated
// verification path reports it distinctly; the import flow still reads any
// non-pack failure as `try_later` (its tests assert exactly that).
function isInvalidToken(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'invalid_token'
  );
}

async function telegramStatusFor(
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

async function mailStatusFor(deps: IntegrationsRoutesDependencies): Promise<{
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
function envMailConfigured(config: ServerConfig): boolean {
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

async function ownerEmailFor(db: ServerDatabase, userId: string): Promise<string> {
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
async function sendWorkingTestMail(input: { mailer: Mailer; email: string }): Promise<void> {
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
