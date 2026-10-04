import type { IntegrationsApi, IntegrationsStatus } from '../../lib/integrations-api';
import { describeIntegrationsError } from './errors';

export interface CardSaveOutcome {
  /** The reloaded status, or null when the save or the reload failed. */
  status: IntegrationsStatus | null;
  /** True only after the status reload proved the save stuck. */
  saved: boolean;
  /** A fixed user-facing sentence, or empty on success. Never raw server text. */
  error: string;
  /** The secret field's next value — empty on success (write-only), kept on failure for retry. */
  secretAfterSave: string;
}

/**
 * The Email card save behind the integrations screen. A pure async step so
 * the screen stays thin and the key handling is unit testable: the caller
 * hands over the typed values, and on success clears its own field state
 * (the Resend key is write-only — it travels only in the PUT body and never
 * comes back). The saved flag flips only after the status reload proves the
 * save stuck; a failed reload clears it so the success line never lies.
 */
export async function saveEmailCard(
  api: IntegrationsApi,
  input: { from: string; key: string },
): Promise<CardSaveOutcome> {
  const from = input.from.trim();
  const key = input.key.trim();
  try {
    await api.saveEmailSettings(key === '' ? { from } : { from, resendApiKey: key });
    return await reloadAfterSave(api, 'Could not save. Try again.', '');
  } catch (cause: unknown) {
    return {
      status: null,
      saved: false,
      error: describeIntegrationsError(cause, 'Could not save. Try again.'),
      secretAfterSave: input.key,
    };
  }
}

/**
 * The Voice transcription card save. Same contract as the Email card: the
 * API key is write-only, and `saved` needs the reload. An empty model means
 * the server default `whisper-1`, mirroring web.
 */
export async function saveVoiceCard(
  api: IntegrationsApi,
  input: { baseUrl: string; model: string; key: string },
): Promise<CardSaveOutcome> {
  const baseUrl = input.baseUrl.trim();
  const key = input.key.trim();
  const model = input.model.trim() === '' ? 'whisper-1' : input.model.trim();
  try {
    await api.saveVoiceTranscriptionSettings({
      baseUrl,
      ...(key === '' ? {} : { apiKey: key }),
      model,
    });
    return await reloadAfterSave(api, 'Could not save. Try again.', '');
  } catch (cause: unknown) {
    return {
      status: null,
      saved: false,
      error: describeIntegrationsError(cause, 'Could not save. Try again.'),
      secretAfterSave: input.key,
    };
  }
}

/**
 * The Telegram bot card save. Same contract: the token is write-only, and
 * `saved` needs the reload.
 */
export async function saveTelegramCard(
  api: IntegrationsApi,
  input: { token: string },
): Promise<CardSaveOutcome> {
  try {
    await api.saveTelegramBotToken(input.token.trim());
    return await reloadAfterSave(api, 'Could not save. Try again.', '');
  } catch (cause: unknown) {
    return {
      status: null,
      saved: false,
      error: describeIntegrationsError(cause, 'Could not save. Try again.'),
      secretAfterSave: input.token,
    };
  }
}

export interface CardRemoveOutcome {
  /** The reloaded status, or null when the remove or the reload failed. */
  status: IntegrationsStatus | null;
  /** True only after the status reload proved the remove stuck. */
  removed: boolean;
  /** A fixed user-facing sentence, or empty on success. Never raw server text. */
  error: string;
}

/**
 * The Telegram / Voice Remove behind the confirm dialog. Same reload rule
 * as the saves: the dialog closes only after the status reload proves the
 * remove stuck, and a failed Remove keeps the dialog open with the error.
 */
export async function removeIntegrationCard(
  api: IntegrationsApi,
  kind: 'telegram' | 'voice',
): Promise<CardRemoveOutcome> {
  try {
    if (kind === 'telegram') {
      await api.removeTelegramBotToken();
    } else {
      await api.removeVoiceTranscriptionSettings();
    }
    const status = await api.getIntegrationsStatus();
    return { status, removed: true, error: '' };
  } catch (cause: unknown) {
    return {
      status: null,
      removed: false,
      error: describeIntegrationsError(cause, 'Could not remove it. Try again.'),
    };
  }
}

async function reloadAfterSave(
  api: IntegrationsApi,
  fallback: string,
  secretAfterSave: string,
): Promise<CardSaveOutcome> {
  try {
    const status = await api.getIntegrationsStatus();
    return { status, saved: true, error: '', secretAfterSave };
  } catch (cause: unknown) {
    return {
      status: null,
      saved: false,
      error: describeIntegrationsError(cause, fallback),
      secretAfterSave,
    };
  }
}
