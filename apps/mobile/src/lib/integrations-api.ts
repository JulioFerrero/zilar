import { z } from 'zod';

import { API_URL } from './auth';

/**
 * The owner integrations API (`/api/settings/integrations` plus the voice
 * transcription endpoint), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/integrations/routes.ts` and
 * `apps/server/src/voice-transcription/routes.ts`.
 *
 * Every route is owner-only: anyone else gets the same 404 as an unknown
 * route, so the screen reads "am I the owner" from 200 versus 404. Secrets
 * (the bot token, the Resend key, the transcription API key) are write-only:
 * the server never returns one, and this module never stores one. A secret
 * travels only in the PUT body of its save call and is dropped by the caller
 * right after.
 *
 * The boundary is validated with zod (`zod` is a mobile dependency, used by
 * `voice-transcripts.ts`). `IntegrationsApiError` keeps the server's `code`
 * and `status`, so cards can branch on the error without parsing the message
 * again.
 */

const telegramStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(['env', 'stored']).nullable(),
});

const emailStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(['env', 'stored']).nullable(),
  from: z.string().nullable(),
});

const voiceStatusSchema = z.object({
  configured: z.boolean(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
});

const integrationsStatusSchema = z.object({
  telegram: telegramStatusSchema,
  email: emailStatusSchema,
  voiceTranscription: voiceStatusSchema.optional(),
  canManage: z.boolean(),
});

const okSchema = z.object({ ok: z.boolean() });

const voiceTranscriptionStatusSchema = z.object({ enabled: z.boolean() });

export type TelegramIntegrationStatus = z.infer<typeof telegramStatusSchema>;
export type EmailIntegrationStatus = z.infer<typeof emailStatusSchema>;
export type VoiceIntegrationStatus = z.infer<typeof voiceStatusSchema>;
export type IntegrationsStatus = z.infer<typeof integrationsStatusSchema>;

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

export class IntegrationsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'IntegrationsApiError';
    this.status = status;
    this.code = code;
  }
}

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

function errorCodeOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return 'request_failed';
  }
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) {
    return 'request_failed';
  }
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : 'request_failed';
}

function errorMessageOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const error = (body as Record<string, unknown>)['error'];
    if (typeof error === 'object' && error !== null) {
      const message = (error as Record<string, unknown>)['message'];
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return `Request failed (${status})`;
}

async function request<T>(
  apiUrl: string,
  path: string,
  token: string,
  schema: z.ZodType<T>,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new IntegrationsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new IntegrationsApiError(
      response.status,
      errorCodeOf(body),
      errorMessageOf(body, response.status),
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new IntegrationsApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.data;
}

/** The production `IntegrationsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createIntegrationsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): IntegrationsApi {
  const withToken = <T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = { method: 'GET' },
  ): Promise<T> =>
    getToken().then((token) => {
      if (token === undefined) {
        throw new IntegrationsApiError(401, 'unauthorized', 'No session');
      }
      return request(apiUrl, path, token, schema, init, fetchImpl);
    });

  const putJson = (path: string, body: Record<string, unknown>): Promise<void> =>
    withToken(path, okSchema, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => {});

  const remove = (path: string): Promise<void> =>
    withToken(path, okSchema, { method: 'DELETE' }).then(() => {});

  return {
    getIntegrationsStatus() {
      return withToken('/api/settings/integrations', integrationsStatusSchema);
    },
    saveTelegramBotToken(botToken) {
      return putJson('/api/settings/integrations/telegram', { botToken });
    },
    removeTelegramBotToken() {
      return remove('/api/settings/integrations/telegram');
    },
    saveEmailSettings(input) {
      return putJson('/api/settings/integrations/email', buildSaveEmailBody(input));
    },
    getVoiceTranscriptionStatus() {
      return withToken('/api/voice/transcription', voiceTranscriptionStatusSchema);
    },
    saveVoiceTranscriptionSettings(input) {
      return putJson('/api/settings/integrations/voice-transcription', buildSaveVoiceBody(input));
    },
    removeVoiceTranscriptionSettings() {
      return remove('/api/settings/integrations/voice-transcription');
    },
  };
}
