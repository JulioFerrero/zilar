// Instance settings store (T-0161). Two keys live in the
// `instance_settings` table: `mail.resend_api_key` (stored encrypted, see
// `setup/crypto.ts`) and `mail.from` (stored in clear text). "Setup
// needed" means no user exists at all: there is no global admin role
// (group roles are per group), so the first user to finish the setup
// screen becomes the implicit first admin and their sign-up closes setup.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { instanceSettings, user } from '../db/schema';
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

import type * as schema from '../db/schema';

type Schema = typeof schema;

export type SetupTransaction =
  | PgTransaction<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>
  | PgTransaction<PgliteQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

type Queryable = ServerDatabase | SetupTransaction;

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

export async function needsSetup(db: Queryable): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1);
  return rows.length === 0;
}

export async function getMailSettings(
  db: Queryable,
  cipher: Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>,
): Promise<MailSettings | null> {
  const rows = await db.select().from(instanceSettings);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const encrypted = byKey.get(RESEND_API_KEY_SETTING);
  const from = byKey.get(MAIL_FROM_SETTING);
  if (encrypted === undefined || from === undefined) {
    return null;
  }
  return { resendApiKey: cipher.decrypt(encrypted), from };
}

export async function saveMailSettings(
  tx: SetupTransaction,
  cipher: Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>,
  settings: MailSettings,
): Promise<void> {
  const entries = [
    { key: RESEND_API_KEY_SETTING, value: cipher.encrypt(settings.resendApiKey) },
    { key: MAIL_FROM_SETTING, value: settings.from },
  ];
  for (const entry of entries) {
    await tx
      .insert(instanceSettings)
      .values(entry)
      .onConflictDoUpdate({
        target: instanceSettings.key,
        set: { value: entry.value, updatedAt: new Date() },
      });
  }
}

export async function deleteMailSettings(tx: SetupTransaction): Promise<void> {
  await tx
    .delete(instanceSettings)
    .where(sql`${instanceSettings.key} IN (${RESEND_API_KEY_SETTING}, ${MAIL_FROM_SETTING})`);
}

export async function takeSetupLock(tx: SetupTransaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK}))`);
}

// Effect versions of the helpers above, on the `effect/sql` client. They are
// for `setup/api.ts` once its transactions move to `sql.withTransaction`; the
// drizzle versions go then.

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
