// Instance-level secrets the owner manages from Settings → Integrations, sealed with the
// envelope cipher; env variables still win when set. The owner is the user with the
// earliest `createdAt` (there is no global admin role), and everyone else gets the same
// 404 as an unknown route.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { createSettingsCipher } from '../setup/crypto';

export const TELEGRAM_BOT_TOKEN_SETTING = 'telegram.bot_token';

type Decrypter = Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>;
type Encrypter = Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>;

interface StoredValueRow {
  value: string;
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
