// Instance settings store (T-0161). Two keys live in the
// `instance_settings` table: `mail.resend_api_key` (stored encrypted, see
// `setup/crypto.ts`) and `mail.from` (stored in clear text). "Setup
// needed" means no user exists at all: there is no global admin role
// (group roles are per group), so the first user to finish the setup
// screen becomes the implicit first admin and their sign-up closes setup.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import { createSettingsCipher } from './crypto';
import type { ServerConfig } from '../config';

export const RESEND_API_KEY_SETTING = 'mail.resend_api_key';
export const MAIL_FROM_SETTING = 'mail.from';

// Serializes first-run setup across processes: two concurrent setups
// race safely because the current state is read INSIDE this lock.
const SETUP_LOCK = 'zilar-first-run-setup';

export interface MailSettings {
  resendApiKey: string;
  from: string;
}

// The envelope-encryption key for instance settings: the explicit
// `ZILAR_KEY_ENCRYPTION_KEY` wins, otherwise it is derived from the auth
// secret — so an install needs no extra variable and the key is never
// stored in clear text.
export function settingsCipherFor(
  config: Pick<ServerConfig, 'ZILAR_KEY_ENCRYPTION_KEY' | 'BETTER_AUTH_SECRET'>,
): { encrypt: (plaintext: string) => string; decrypt: (envelope: string) => string } {
  const masterKey = config.ZILAR_KEY_ENCRYPTION_KEY ?? config.BETTER_AUTH_SECRET;
  return createSettingsCipher(masterKey);
}

// Wrappers over the `effect/sql` helpers below: every query runs
// on the runtime registered for this database (see `../effect/sql`). They stay
// `async` so routes, `index.ts` and existing tests keep their shape.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

export function needsSetup(db: ServerDatabase): Promise<boolean> {
  return runSql(db, needsSetupEffect());
}

export function getMailSettings(
  db: ServerDatabase,
  cipher: Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>,
): Promise<MailSettings | null> {
  return runSql(db, getMailSettingsEffect(cipher));
}

// The `effect/sql` helpers the wrappers above and `setup/api.ts` use. The setup
// transactions run them through `sql.withTransaction`.

interface InstanceSettingRow {
  key: string;
  value: string;
}

export function needsSetupEffect(): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const rows = yield* client<{ id: string }>`SELECT id FROM "user" LIMIT 1`;
    return rows.length === 0;
  });
}

export function getMailSettingsEffect(
  cipher: Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>,
): Effect.Effect<MailSettings | null, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const rows = yield* client<InstanceSettingRow>`SELECT key, value FROM instance_settings
      WHERE key IN (${RESEND_API_KEY_SETTING}, ${MAIL_FROM_SETTING})`;
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const encrypted = byKey.get(RESEND_API_KEY_SETTING);
    const from = byKey.get(MAIL_FROM_SETTING);
    if (encrypted === undefined || from === undefined) {
      return null;
    }
    return { resendApiKey: cipher.decrypt(encrypted), from };
  });
}

export function saveMailSettingsEffect(
  cipher: Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>,
  settings: MailSettings,
): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const entries = [
      { key: RESEND_API_KEY_SETTING, value: cipher.encrypt(settings.resendApiKey) },
      { key: MAIL_FROM_SETTING, value: settings.from },
    ];
    for (const entry of entries) {
      yield* client`INSERT INTO instance_settings (key, value)
        VALUES (${entry.key}, ${entry.value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
  });
}

export function deleteMailSettingsEffect(): Effect.Effect<
  void,
  SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    yield* client`DELETE FROM instance_settings
      WHERE key IN (${RESEND_API_KEY_SETTING}, ${MAIL_FROM_SETTING})`;
  });
}

export function takeSetupLockEffect(): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    yield* client`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK}))`;
  });
}
