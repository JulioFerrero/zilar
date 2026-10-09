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

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import type { createSettingsCipher } from '../setup/crypto';

// The mail helpers (`getMailSettings`, `saveMailSettingsEffect`,
// `settingsCipherFor`, `RESEND_API_KEY_SETTING`, `MAIL_FROM_SETTING`)
// live in `setup/settings.ts` and are used as-is; this module adds only
// the Telegram bot token key.
export const TELEGRAM_BOT_TOKEN_SETTING = 'telegram.bot_token';

type Decrypter = Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>;
type Encrypter = Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>;

interface StoredValueRow {
  value: string;
}

// Reads and writes run on the `effect/sql` client registered for this database
// (see `../effect/sql`); the exported functions stay `async` so routes and
// tests keep their shape.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

export async function getStoredTelegramToken(
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

export async function saveStoredTelegramToken(
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

export async function deleteStoredTelegramToken(db: ServerDatabase): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`DELETE FROM instance_settings WHERE key = ${TELEGRAM_BOT_TOKEN_SETTING}`;
    }),
  );
}
