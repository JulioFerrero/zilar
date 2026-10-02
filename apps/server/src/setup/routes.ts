// First-run setup routes (T-0161). Whoever opens a new server first
// sets it up: there is no setup token. "Setup needed" means no user
// exists at all (there is no global admin role); once a user exists the
// setup routes answer the same 404 as an unknown route.
//
// POST /api/setup stores the Resend settings (encrypted) and creates
// the first-admin invite for the admin email in ONE transaction under
// an advisory lock, then sends a test sign-in code to the admin email
// through the new mailer. If sending fails, the stored settings are
// rolled back and the call answers 422 `mail_send_failed` with no
// provider detail. Success answers 200 `{ ok: true, inviteCode }`. The
// invite code is for the web client only: the client keeps it in memory
// (never in storage, URL or logs) and sends it with the sign-up request
// itself. The admin only types the 6-digit code from their inbox. The
// first admin is created only when their email completes the sign-in
// code, so a wrong email cannot take the server over and setup stays
// open for a retry.

import { Hono, type Context } from 'hono';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
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
import { invites } from '../db/schema';
import { HttpError } from '../errors';
import { clientIpFor } from '../invite-links/routes';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  deleteMailSettings,
  getMailSettings,
  needsSetup,
  saveMailSettings,
  settingsCipherFor,
  takeSetupLock,
  type SetupTransaction,
} from './settings';

export const SETUP_RATE_LIMIT_MAX = 5;
export const SETUP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const setupSchema = z.object({
  resendApiKey: z
    .string()
    .trim()
    .min(1, { message: 'resendApiKey must not be empty' })
    .max(256, { message: 'resendApiKey must be at most 256 characters' }),
  from: z
    .string()
    .trim()
    .min(1, { message: 'from must not be empty' })
    .max(320, { message: 'from must be at most 320 characters' }),
  adminEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { message: 'adminEmail must not be empty' })
    .max(320, { message: 'adminEmail must be at most 320 characters' })
    .pipe(z.email({ message: 'adminEmail must be a valid email address' })),
});

export interface SetupRoutesDependencies {
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
  getClientIp?: ((c: Context) => string) | undefined;
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

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

export function createSetupRoutes(deps: SetupRoutesDependencies): Hono {
  const routes = new Hono();
  const limiter =
    deps.limiter ??
    createRateLimiter({ max: SETUP_RATE_LIMIT_MAX, windowMs: SETUP_RATE_LIMIT_WINDOW_MS });
  // Same client-IP rule as the join limiter: with N trusted proxy hops
  // the Nth address from the right of `x-forwarded-for` counts, otherwise
  // the socket address — behind Coolify every visitor must not share one
  // budget.
  const clientIp =
    deps.getClientIp ?? clientIpFor(deps.trustedProxyHops ?? deps.config.TRUSTED_PROXY_HOPS);

  routes.get('/setup/status', async (c) => {
    if (!(await needsSetup(deps.db))) {
      return c.json({ needsSetup: false, mailConfigured: true });
    }
    return c.json({ needsSetup: true, mailConfigured: await mailConfigured(deps) });
  });

  routes.post('/setup', async (c) => {
    // Setup-done first: once an admin exists every caller gets the same
    // 404 as an unknown route, never a 429.
    if (!(await needsSetup(deps.db))) {
      throw notFound();
    }
    if (!limiter.allow(clientIp(c))) {
      throw new HttpError(429, 'rate_limited', 'Too many setup attempts, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { resendApiKey, from, adminEmail } = parsed.data;

    const cipher = settingsCipherFor(deps.config);
    let inviteCode: string | null = null;
    try {
      await deps.db.transaction(async (tx: SetupTransaction) => {
        await takeSetupLock(tx);
        // Re-check inside the lock: a concurrent setup (or a sign-up
        // racing the check above) must not create a second invite.
        if (await needsSetup(tx)) {
          await saveMailSettings(tx, cipher, { resendApiKey, from });
          inviteCode = await createSetupInvite(tx);
        }
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(500, 'internal_error', 'Setup failed, try again');
    }
    if (inviteCode === null) {
      // A concurrent setup finished first: same 404 as a finished setup.
      throw notFound();
    }

    const code: string = inviteCode;
    const candidate = createResendMailer(deps.config, deps.logger, { resendApiKey, from });
    const send = deps.sendTestCode ?? sendSetupTestCode;
    const swap = deps.swapMailer ?? ((mailer: Mailer): void => deps.mailer.use(mailer));
    try {
      await send({ auth: deps.auth, mailer: candidate, email: adminEmail, inviteCode: code });
    } catch {
      try {
        await deps.db.transaction(async (tx) => {
          await takeSetupLock(tx);
          // Roll back the settings AND the invite only while setup is
          // still open (no user signed up in the meantime). Never delete
          // on a concurrent success: both rows belong to the finished
          // setup then.
          if (await needsSetup(tx)) {
            await deleteMailSettings(tx);
            await tx.delete(invites).where(eq(invites.code, code));
          }
        });
      } catch (rollbackError) {
        // The cleanup must never mask the specified answer or leak
        // provider detail: one line with the error name, then 422 below.
        deps.logger.warn(
          { errName: rollbackError instanceof Error ? rollbackError.name : 'unknown' },
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

    return c.json({ ok: true, inviteCode: code });
  });

  return routes;
}

// Env-based SMTP installs behave exactly as before: explicit
// `MAIL_TRANSPORT`/`SMTP_*` env means mail is configured without the
// setup screen. Otherwise mail is configured exactly when the setup
// screen's stored settings exist (read here without the key, so the
// secret is never decrypted just to answer the status).
async function mailConfigured(deps: SetupRoutesDependencies): Promise<boolean> {
  if (deps.config.MAIL_TRANSPORT !== undefined) {
    return true;
  }
  return (await getMailSettings(deps.db, settingsCipherFor(deps.config))) !== null;
}

// Inserts the first-admin invite directly: `createInvite` takes the full
// database, not a transaction, and this insert must commit atomically
// with the settings above. Same single-use, 7-day shape as a bootstrap
// invite (see `auth/invites.ts`).
async function createSetupInvite(tx: SetupTransaction): Promise<string> {
  const now = new Date();
  const code = generateInviteCode();
  const [invite] = await tx
    .insert(invites)
    .values({
      id: randomUUID(),
      code,
      createdBy: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + DEFAULT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      maxUses: DEFAULT_INVITE_MAX_USES,
      uses: 0,
    })
    .returning();
  if (!invite) {
    throw new HttpError(500, 'internal_error', 'Setup failed, try again');
  }
  return invite.code;
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
