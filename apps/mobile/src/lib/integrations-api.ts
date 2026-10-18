import { Schema } from 'effect';
import { EnabledStatus, runApi, type IntegrationsStatus } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { rawRequest } from './effect/raw-request';

/**
 * Every route is owner-only: anyone else gets the same 404 as an unknown route, so the screen reads "am I the owner" from 200 versus 404. Secrets (bot token, Resend key, transcription key) are write-only and travel only in the PUT body; a request body is never logged.
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

export function buildSaveEmailBody(input: SaveEmailSettingsInput): Record<string, unknown> {
  return input.resendApiKey === undefined
    ? { from: input.from }
    : { from: input.from, resendApiKey: input.resendApiKey };
}

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

export function createIntegrationsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): IntegrationsApi {
  const transport = { getToken, fetchImpl, apiUrl };
  const client = createApiClient(transport);

  // The voice transcription routes are outside the contract: one request, `ApiError` only.
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
