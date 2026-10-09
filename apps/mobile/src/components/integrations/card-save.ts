import { Effect } from 'effect';
import type { IntegrationsApi, IntegrationsStatus } from '../../lib/integrations-api';
import { runMobile } from '../../lib/effect/runtime';
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
export function saveEmailCard(
  api: IntegrationsApi,
  input: { from: string; key: string },
): Promise<CardSaveOutcome> {
  const from = input.from.trim();
  const key = input.key.trim();
  return runMobile(
    saveThenReload(api, input.key, () =>
      api.saveEmailSettings(key === '' ? { from } : { from, resendApiKey: key }),
    ),
  );
}

/**
 * The Voice transcription card save. Same contract as the Email card: the
 * API key is write-only, and `saved` needs the reload. An empty model means
 * the server default `whisper-1`, mirroring web.
 */
export function saveVoiceCard(
  api: IntegrationsApi,
  input: { baseUrl: string; model: string; key: string },
): Promise<CardSaveOutcome> {
  const baseUrl = input.baseUrl.trim();
  const key = input.key.trim();
  const model = input.model.trim() === '' ? 'whisper-1' : input.model.trim();
  return runMobile(
    saveThenReload(api, input.key, () =>
      api.saveVoiceTranscriptionSettings({
        baseUrl,
        ...(key === '' ? {} : { apiKey: key }),
        model,
      }),
    ),
  );
}

/**
 * The Telegram bot card save. Same contract: the token is write-only, and
 * `saved` needs the reload.
 */
export function saveTelegramCard(
  api: IntegrationsApi,
  input: { token: string },
): Promise<CardSaveOutcome> {
  return runMobile(
    saveThenReload(api, input.token, () => api.saveTelegramBotToken(input.token.trim())),
  );
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
export function removeIntegrationCard(
  api: IntegrationsApi,
  kind: 'telegram' | 'voice',
): Promise<CardRemoveOutcome> {
  return runMobile(
    Effect.tryPromise({
      try: () =>
        kind === 'telegram' ? api.removeTelegramBotToken() : api.removeVoiceTranscriptionSettings(),
      catch: (cause: unknown) => cause,
    }).pipe(
      Effect.flatMap(() => statusEffect(api)),
      Effect.match({
        onSuccess: (status): CardRemoveOutcome => ({ status, removed: true, error: '' }),
        onFailure: (cause): CardRemoveOutcome => ({
          status: null,
          removed: false,
          error: describeIntegrationsError(cause, 'Could not remove it. Try again.'),
        }),
      }),
    ),
  );
}

/** Runs one save; on success reloads the status, on failure keeps the typed secret for retry. */
function saveThenReload(
  api: IntegrationsApi,
  typedSecret: string,
  save: () => Promise<unknown>,
): Effect.Effect<CardSaveOutcome> {
  return Effect.tryPromise({ try: save, catch: (cause: unknown) => cause }).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        Effect.succeed<CardSaveOutcome>({
          status: null,
          saved: false,
          error: describeIntegrationsError(cause, 'Could not save. Try again.'),
          secretAfterSave: typedSecret,
        }),
      onSuccess: () => reloadAfterSave(api, 'Could not save. Try again.', ''),
    }),
  );
}

function statusEffect(api: IntegrationsApi): Effect.Effect<IntegrationsStatus, unknown> {
  return Effect.tryPromise({
    try: () => api.getIntegrationsStatus(),
    catch: (cause: unknown) => cause,
  });
}

function reloadAfterSave(
  api: IntegrationsApi,
  fallback: string,
  secretAfterSave: string,
): Effect.Effect<CardSaveOutcome> {
  return statusEffect(api).pipe(
    Effect.match({
      onSuccess: (status): CardSaveOutcome => ({ status, saved: true, error: '', secretAfterSave }),
      onFailure: (cause): CardSaveOutcome => ({
        status: null,
        saved: false,
        error: describeIntegrationsError(cause, fallback),
        secretAfterSave,
      }),
    }),
  );
}
