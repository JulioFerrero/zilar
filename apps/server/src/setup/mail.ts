// The invite and mail helpers for first-run setup, split out of `setup/api.ts`
// in T-1120 with no behaviour change.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { Auth } from '../auth/auth';
import { INVITE_HEADER } from '../auth/auth';
import {
  DEFAULT_INVITE_MAX_USES,
  DEFAULT_INVITE_TTL_DAYS,
  generateInviteCode,
} from '../auth/invites';
import type { Mailer } from '../auth/mailer';
import { HttpError } from '../errors';
import type { SetupApiDependencies } from './api';
import { getMailSettings, settingsCipherFor } from './settings';

// Env-based SMTP installs behave exactly as before: explicit
// `MAIL_TRANSPORT`/`SMTP_*` env means mail is configured without the
// setup screen. Otherwise mail is configured exactly when the setup
// screen's stored settings exist (read here without the key, so the
// secret is never decrypted just to answer the status).
export async function mailConfigured(deps: SetupApiDependencies): Promise<boolean> {
  if (deps.config.MAIL_TRANSPORT !== undefined) {
    return true;
  }
  return (await getMailSettings(deps.db, settingsCipherFor(deps.config))) !== null;
}

// Inserts the first-admin invite directly: the setup transaction must commit
// it atomically with the settings above. Same single-use, 7-day shape as a
// bootstrap invite (see `auth/invites.ts`).
export function createSetupInvite(): Effect.Effect<
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
export async function sendSetupTestCode(input: {
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
