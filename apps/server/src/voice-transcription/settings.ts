// Voice transcription settings (T-0170). Instance-level settings the
// server owner manages from Settings → Integrations: the
// OpenAI-compatible transcription endpoint (base URL + optional API key,
// stored encrypted like the Telegram token) plus the model name (stored in
// clear text, like the mail sender).
//
// There is no per-install env override: transcription is off by default and
// only a stored, owner-verified endpoint turns it on.

import { eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { instanceSettings } from '../db/schema';
import type { createSettingsCipher } from '../setup/crypto';
import type { SetupTransaction } from '../setup/settings';

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

export async function getVoiceTranscriptionSettings(
  db: ServerDatabase,
  cipher: Decrypter,
): Promise<VoiceTranscriptionSettings | null> {
  const rows = await db.select().from(instanceSettings);
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
  tx: SetupTransaction,
  cipher: Encrypter,
  settings: VoiceTranscriptionSettings,
): Promise<void> {
  const entries = [
    { key: VOICE_TRANSCRIPTION_BASE_URL_SETTING, value: settings.baseUrl },
    { key: VOICE_TRANSCRIPTION_MODEL_SETTING, value: settings.model },
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
  if (settings.apiKey === null) {
    await tx
      .delete(instanceSettings)
      .where(eq(instanceSettings.key, VOICE_TRANSCRIPTION_API_KEY_SETTING));
  } else {
    const value = cipher.encrypt(settings.apiKey);
    await tx
      .insert(instanceSettings)
      .values({ key: VOICE_TRANSCRIPTION_API_KEY_SETTING, value })
      .onConflictDoUpdate({
        target: instanceSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

export async function deleteVoiceTranscriptionSettings(tx: SetupTransaction): Promise<void> {
  for (const key of [
    VOICE_TRANSCRIPTION_BASE_URL_SETTING,
    VOICE_TRANSCRIPTION_API_KEY_SETTING,
    VOICE_TRANSCRIPTION_MODEL_SETTING,
  ]) {
    await tx.delete(instanceSettings).where(eq(instanceSettings.key, key));
  }
}
