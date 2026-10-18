import { Effect } from 'effect';
import type { IntegrationsApi, IntegrationsStatus } from '../../lib/integrations-api';
import { runMobile } from '../../lib/effect/runtime';
import { describeIntegrationsError } from './errors';

export interface CardSaveOutcome {
  status: IntegrationsStatus | null;
  saved: boolean;
  error: string;
  secretAfterSave: string;
}

/**
 * The Email card save. A pure async step so the screen stays thin and the key
 * handling is unit testable: the Resend key is write-only, it travels only in
 * the PUT body and never comes back. `saved` flips only after the status reload
 * proves the save stuck; a failed reload clears it so the success line never lies.
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
 * The Voice transcription card save: same contract as the Email card, the API key
 * is write-only and `saved` needs the reload. An empty model means the server
 * default `whisper-1`, mirroring web.
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
 * The Telegram bot card save: the token is write-only, and `saved` needs the reload.
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
  status: IntegrationsStatus | null;
  removed: boolean;
  error: string;
}

/**
 * The Telegram / Voice Remove behind the confirm dialog: the dialog closes only
 * after the status reload proves the remove stuck, and a failed Remove keeps it
 * open with the error.
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
