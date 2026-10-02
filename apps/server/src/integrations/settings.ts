// Integration settings (T-0162). Instance-level secrets the server
// owner manages from Settings → Integrations: the Telegram bot token and,
// since the lead's follow-up, the Resend key + sender for sign-in mail.
//
// Both live in the `instance_settings` table T-0161 built, sealed with the
// same envelope cipher (`setup/crypto.ts` via `setup/settings.ts`). The
// environment variables still win when set, so explicit env installs behave
// exactly as before.
//
// The server owner is the user with the earliest `createdAt`: there is no
// global admin role (group roles are per group), so the first account to
// exist owns the integration settings. Every route answers the same 404 as
// an unknown route for anyone else — a non-owner cannot tell an unknown
// path from a forbidden one.

import { eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { instanceSettings } from '../db/schema';
import type { createSettingsCipher } from '../setup/crypto';
import type { SetupTransaction } from '../setup/settings';

// The mail helpers (`getMailSettings`, `saveMailSettings`,
// `settingsCipherFor`, `RESEND_API_KEY_SETTING`, `MAIL_FROM_SETTING`)
// live in `setup/settings.ts` and are used as-is; this module adds only
// the Telegram bot token key.
export const TELEGRAM_BOT_TOKEN_SETTING = 'telegram.bot_token';

type Decrypter = Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>;
type Encrypter = Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>;

export async function getStoredTelegramToken(
  db: ServerDatabase,
  cipher: Decrypter,
): Promise<string | null> {
  const rows = await db.select().from(instanceSettings);
  const row = rows.find((entry) => entry.key === TELEGRAM_BOT_TOKEN_SETTING);
  if (row === undefined) {
    return null;
  }
  return cipher.decrypt(row.value);
}

export async function saveStoredTelegramToken(
  tx: SetupTransaction,
  cipher: Encrypter,
  token: string,
): Promise<void> {
  const value = cipher.encrypt(token);
  await tx
    .insert(instanceSettings)
    .values({ key: TELEGRAM_BOT_TOKEN_SETTING, value })
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function deleteStoredTelegramToken(tx: SetupTransaction): Promise<void> {
  await tx.delete(instanceSettings).where(eq(instanceSettings.key, TELEGRAM_BOT_TOKEN_SETTING));
}
