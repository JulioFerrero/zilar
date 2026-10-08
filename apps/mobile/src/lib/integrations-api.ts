import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

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
 * The boundary is validated with Effect Schema (T-0532, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `IntegrationsApiError` keeps the server's `code` and
 * `status`, so cards can branch on the error without parsing the message
 * again. A request body is never logged.
 */

const SourceSchema = Schema.NullOr(Schema.Literals(['env', 'stored']));

const TelegramStatusSchema = struct({
  configured: Schema.Boolean,
  source: SourceSchema,
});

const EmailStatusSchema = struct({
  configured: Schema.Boolean,
  source: SourceSchema,
  from: Schema.NullOr(Schema.String),
});

const VoiceStatusSchema = struct({
  configured: Schema.Boolean,
  baseUrl: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
});

const IntegrationsStatusSchema = struct({
  telegram: TelegramStatusSchema,
  email: EmailStatusSchema,
  voiceTranscription: Schema.optional(VoiceStatusSchema),
  canManage: Schema.Boolean,
});

const OkSchema = struct({ ok: Schema.Boolean });

const VoiceTranscriptionStatusSchema = struct({ enabled: Schema.Boolean });

export type TelegramIntegrationStatus = typeof TelegramStatusSchema.Type;
export type EmailIntegrationStatus = typeof EmailStatusSchema.Type;
export type VoiceIntegrationStatus = typeof VoiceStatusSchema.Type;
export type IntegrationsStatus = typeof IntegrationsStatusSchema.Type;

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

// The server's error envelope is decoded field by field, so a malformed `code`
// does not discard a valid `message` (and vice versa). A missing or malformed
// envelope keeps the fixed fallbacks used by `requestEffect`, as the old
// per-field guards did.
const LenientErrorStringSchema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(LenientErrorStringSchema),
    message: Schema.optional(LenientErrorStringSchema),
  }),
});

function parseIntegrationsStatus(value: unknown): IntegrationsStatus | null {
  const decoded = Schema.decodeUnknownExit(IntegrationsStatusSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseVoiceTranscriptionStatus(value: unknown): { enabled: boolean } | null {
  const decoded = Schema.decodeUnknownExit(VoiceTranscriptionStatusSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseOk(value: unknown): unknown | null {
  const decoded = Schema.decodeUnknownExit(OkSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `IntegrationsApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class IntegrationsNetworkError extends Data.TaggedError('IntegrationsNetworkError') {}
class IntegrationsRequestError extends Data.TaggedError('IntegrationsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class IntegrationsUnauthorized extends Data.TaggedError('IntegrationsUnauthorized') {}
class IntegrationsInvalidResponse extends Data.TaggedError('IntegrationsInvalidResponse')<{
  readonly status: number;
}> {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  parse: (value: unknown) => unknown,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<
  unknown,
  IntegrationsNetworkError | IntegrationsRequestError | IntegrationsInvalidResponse
> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new IntegrationsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const decoded = Schema.decodeUnknownExit(ErrorBodySchema)(body);
    const error = Exit.isSuccess(decoded) ? decoded.value.error : undefined;
    return yield* new IntegrationsRequestError({
      status: response.status,
      code: error?.code ?? 'request_failed',
      message: error?.message ?? `Request failed (${response.status})`,
    });
  }

  const parsed = parse(body);
  if (parsed === null) {
    return yield* new IntegrationsInvalidResponse({ status: response.status });
  }
  return parsed;
});

/** The production `IntegrationsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createIntegrationsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): IntegrationsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    parse: (value: unknown) => unknown,
    init: RequestInit,
  ): EffectType.fn.Return<
    unknown,
    | IntegrationsUnauthorized
    | IntegrationsNetworkError
    | IntegrationsRequestError
    | IntegrationsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new IntegrationsUnauthorized();
    }
    return yield* requestEffect(apiUrl, path, token, parse, init, fetchImpl);
  });

  const withToken = (
    path: string,
    parse: (value: unknown) => unknown,
    init: RequestInit = { method: 'GET' },
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, parse, init).pipe(
        Effect.catchTags({
          IntegrationsUnauthorized: () =>
            Effect.fail(new IntegrationsApiError(401, 'unauthorized', 'No session')),
          IntegrationsNetworkError: () =>
            Effect.fail(new IntegrationsApiError(0, 'network_error', 'Could not reach the server')),
          IntegrationsRequestError: (error) =>
            Effect.fail(new IntegrationsApiError(error.status, error.code, error.message)),
          IntegrationsInvalidResponse: (error) =>
            Effect.fail(
              new IntegrationsApiError(
                error.status,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  const putJson = (path: string, body: Record<string, unknown>): Promise<void> =>
    withToken(path, parseOk, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => {});

  const remove = (path: string): Promise<void> =>
    withToken(path, parseOk, { method: 'DELETE' }).then(() => {});

  return {
    getIntegrationsStatus() {
      return withToken(
        '/api/settings/integrations',
        parseIntegrationsStatus,
      ) as Promise<IntegrationsStatus>;
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
      return withToken('/api/voice/transcription', parseVoiceTranscriptionStatus) as Promise<{
        enabled: boolean;
      }>;
    },
    saveVoiceTranscriptionSettings(input) {
      return putJson('/api/settings/integrations/voice-transcription', buildSaveVoiceBody(input));
    },
    removeVoiceTranscriptionSettings() {
      return remove('/api/settings/integrations/voice-transcription');
    },
  };
}
