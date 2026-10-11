import { Schema } from 'effect';
import { ApiError, EnabledStatus, runApi, type IntegrationsStatus } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { rawRequest } from './effect/raw-request';

/**
 * The owner integrations API (`/api/settings/integrations` plus the voice
 * transcription endpoints), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The integrations routes come from the client
 * derived from the shared contract (`@zilar/api-contract`, `integrations.ts`,
 * T-0895). The voice transcription routes (`apps/server/src/voice-transcription/`)
 * are not in the contract yet, so they keep a small hand-written request below.
 *
 * Every route is owner-only: anyone else gets the same 404 as an unknown
 * route, so the screen reads "am I the owner" from 200 versus 404. Secrets
 * (the bot token, the Resend key, the transcription API key) are write-only:
 * the server never returns one, and this module never stores one. A secret
 * travels only in the PUT body of its save call and is dropped by the caller
 * right after. A request body is never logged.
 */

export type {
  EmailIntegrationStatus,
  IntegrationsStatus,
  TelegramIntegrationStatus,
  VoiceIntegrationStatus,
} from '@zilar/api-contract';

const OkSchema = struct({ ok: Schema.Boolean });

export interface SaveEmailSettingsInput {
  from: string;
  resendApiKey?: string | undefined;
}

export interface SaveVoiceTranscriptionInput {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
}

export interface IntegrationsApi {
  getIntegrationsStatus(): Promise<IntegrationsStatus>;
  saveTelegramBotToken(botToken: string): Promise<void>;
  removeTelegramBotToken(): Promise<void>;
  saveEmailSettings(input: SaveEmailSettingsInput): Promise<void>;
  getVoiceTranscriptionStatus(): Promise<{ enabled: boolean }>;
  saveVoiceTranscriptionSettings(input: SaveVoiceTranscriptionInput): Promise<void>;
  removeVoiceTranscriptionSettings(): Promise<void>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const IntegrationsApiError = ApiError;
export type IntegrationsApiError = ApiError;

/** The exact PUT body the server's strict `emailBodySchema` accepts. */
export function buildSaveEmailBody(input: SaveEmailSettingsInput): Record<string, unknown> {
  return input.resendApiKey === undefined
    ? { from: input.from }
    : { from: input.from, resendApiKey: input.resendApiKey };
}

/** The exact PUT body the server's strict `voiceSettingsBodySchema` accepts. */
export function buildSaveVoiceBody(input: SaveVoiceTranscriptionInput): Record<string, string> {
  const body: Record<string, string> = { baseUrl: input.baseUrl };
  if (input.apiKey !== undefined) {
    body['apiKey'] = input.apiKey;
  }
  if (input.model !== undefined) {
    body['model'] = input.model;
  }
  return body;
}

/** The production `IntegrationsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createIntegrationsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): IntegrationsApi {
  const transport = { getToken, fetchImpl, apiUrl };
  const client = createApiClient(transport);

  // The voice transcription routes are outside the contract: one request, the
  // same errors as the derived client (`ApiError` only).
  const voiceRequest = <T>(
    path: string,
    schema: Schema.Codec<T, unknown>,
    init: RequestInit,
  ): Promise<T> => rawRequest(transport, path, schema, init);

  const voicePut = (body: Record<string, string>): Promise<void> =>
    voiceRequest('/api/settings/integrations/voice-transcription', OkSchema, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => {});

  return {
    getIntegrationsStatus: () => runApi(client.integrations.status()),
    saveTelegramBotToken: (botToken) =>
      runApi(client.integrations.setTelegram({ payload: { botToken: botToken.trim() } })).then(
        () => {},
      ),
    removeTelegramBotToken: () => runApi(client.integrations.removeTelegram()).then(() => {}),
    saveEmailSettings: (input) =>
      runApi(
        client.integrations.setEmail({
          payload: {
            from: input.from.trim(),
            ...(input.resendApiKey === undefined
              ? {}
              : { resendApiKey: input.resendApiKey.trim() }),
          },
        }),
      ).then(() => {}),
    getVoiceTranscriptionStatus: () =>
      voiceRequest('/api/voice/transcription', EnabledStatus, { method: 'GET' }),
    saveVoiceTranscriptionSettings: (input) => voicePut(buildSaveVoiceBody(input)),
    removeVoiceTranscriptionSettings: () =>
      voiceRequest('/api/settings/integrations/voice-transcription', OkSchema, {
        method: 'DELETE',
      }).then(() => {}),
  };
}
