// Voice transcription settings (T-0170). Instance-level settings the
// server owner manages from Settings → Integrations: the
// OpenAI-compatible transcription endpoint (base URL + optional API key,
// stored encrypted like the Telegram token) plus the model name (stored in
// clear text, like the mail sender).
//
// There is no per-install env override: transcription is off by default and
// only a stored, owner-verified endpoint turns it on.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { createSettingsCipher } from '../setup/crypto';

export const VOICE_TRANSCRIPTION_BASE_URL_SETTING = 'voice_transcription.base_url';
export const VOICE_TRANSCRIPTION_API_KEY_SETTING = 'voice_transcription.api_key';
export const VOICE_TRANSCRIPTION_MODEL_SETTING = 'voice_transcription.model';

export const VOICE_TRANSCRIPTION_DEFAULT_MODEL = 'whisper-1';

export interface VoiceTranscriptionSettings {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

type Decrypter = Pick<ReturnType<typeof createSettingsCipher>, 'decrypt'>;
type Encrypter = Pick<ReturnType<typeof createSettingsCipher>, 'encrypt'>;

interface InstanceSettingRow {
  key: string;
  value: string;
}

export async function getVoiceTranscriptionSettings(
  db: ServerDatabase,
  cipher: Decrypter,
): Promise<VoiceTranscriptionSettings | null> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<InstanceSettingRow>`SELECT key, value FROM instance_settings`;
    }),
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const baseUrl = byKey.get(VOICE_TRANSCRIPTION_BASE_URL_SETTING);
  const encryptedKey = byKey.get(VOICE_TRANSCRIPTION_API_KEY_SETTING);
  if (baseUrl === undefined) {
    return null;
  }
  return {
    baseUrl,
    apiKey: encryptedKey === undefined ? null : cipher.decrypt(encryptedKey),
    model: byKey.get(VOICE_TRANSCRIPTION_MODEL_SETTING) ?? VOICE_TRANSCRIPTION_DEFAULT_MODEL,
  };
}

export async function saveVoiceTranscriptionSettings(
  db: ServerDatabase,
  cipher: Encrypter,
  settings: VoiceTranscriptionSettings,
): Promise<void> {
  const entries = [
    { key: VOICE_TRANSCRIPTION_BASE_URL_SETTING, value: settings.baseUrl },
    { key: VOICE_TRANSCRIPTION_MODEL_SETTING, value: settings.model },
  ];
  const encryptedKey = settings.apiKey === null ? null : cipher.encrypt(settings.apiKey);
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const entry of entries) {
            yield* sql`INSERT INTO instance_settings (key, value)
              VALUES (${entry.key}, ${entry.value})
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
          }
          if (encryptedKey === null) {
            yield* sql`DELETE FROM instance_settings WHERE key = ${VOICE_TRANSCRIPTION_API_KEY_SETTING}`;
          } else {
            yield* sql`INSERT INTO instance_settings (key, value)
              VALUES (${VOICE_TRANSCRIPTION_API_KEY_SETTING}, ${encryptedKey})
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
          }
        }),
      );
    }),
  );
}

export async function deleteVoiceTranscriptionSettings(db: ServerDatabase): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const key of [
            VOICE_TRANSCRIPTION_BASE_URL_SETTING,
            VOICE_TRANSCRIPTION_API_KEY_SETTING,
            VOICE_TRANSCRIPTION_MODEL_SETTING,
          ]) {
            yield* sql`DELETE FROM instance_settings WHERE key = ${key}`;
          }
        }),
      );
    }),
  );
}
