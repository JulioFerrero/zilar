import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';

/**
 * The AI management API (`/api/ais`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/ais/api.ts` and `apps/server/src/ais/service.ts`.
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `AisApiError` keeps the server's `code` and `status`,
 * so screens can branch on the error without parsing the message again.
 */

export type AiTemplate = 'dev' | 'marketing' | 'fun' | 'custom';

export interface AiLimits {
  perDayUsd: number;
  perMonthUsd: number;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  // `stopped` is the owner kill switch (T-0080). Mobile only renders the
  // AI list, so accepting it in the type guard keeps the list rendering
  // for a paused AI — the screen shows it as "stopped" rather than failing.
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  limits: AiLimits;
  // T-0091: the AI's home machine id, or null when it runs on the
  // platform. Optional so older payloads stay valid; the parser maps a
  // missing or non-string value to null. CamelCase like the rest of the
  // public AI fields.
  machineId?: string | null | undefined;
  createdAt: string;
}

export interface Connection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  createdAt: string;
}

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  /** Omit for a stock template the user did not edit: the server applies its default. */
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

/** PATCH carries only the fields that actually changed. */
export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
}

export interface AisApi {
  listAis(): Promise<PublicAi[]>;
  createAi(input: CreateAiInput): Promise<PublicAi>;
  updateAi(id: string, input: UpdateAiInput): Promise<PublicAi>;
  deleteAi(id: string): Promise<void>;
  listConnections(): Promise<Connection[]>;
  // T-0080: the owner kill switch. The server answers the fresh public AI so
  // the list can swap the row against server truth without a second GET.
  stopAi(id: string): Promise<PublicAi>;
  resumeAi(id: string): Promise<PublicAi>;
}

export class AisApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AisApiError';
    this.status = status;
    this.code = code;
  }
}

const AiTemplateSchema = Schema.Literals(['dev', 'marketing', 'fun', 'custom']);

const AiLimitsSchema = struct({
  perDayUsd: Schema.Number,
  perMonthUsd: Schema.Number,
});

// A lenient field: a missing or non-string `machineId` decodes to `null`
// instead of failing the row (the platform, never a failure — an older server
// may omit it), exactly like the old type guard.
const LenientMachineIdSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

// Tolerant of unknown fields (the server also sends `avatarUrl` on the
// public AI, T-0165): only the fields mobile renders are required.
const PublicAiSchema = struct({
  id: Schema.String,
  name: Schema.String,
  template: AiTemplateSchema,
  persona: Schema.String,
  model: Schema.String,
  jid: Schema.String,
  status: Schema.Literals(['active', 'disabled', 'stopped']),
  providerConnectionId: Schema.String,
  limits: AiLimitsSchema,
  machineId: LenientMachineIdSchema,
  createdAt: Schema.String,
});

// A lenient field: a missing or non-string `label` decodes to `null` instead
// of failing the row, exactly like the old type guard.
const LenientLabelSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const ConnectionSchema = struct({
  id: Schema.String,
  provider: Schema.String,
  label: LenientLabelSchema,
  status: Schema.String,
  createdAt: Schema.String,
});

// The lists are bare arrays (not envelopes); `Array` is made mutable to keep
// the array types the API has always returned.
const PublicAiListSchema = Schema.mutable(Schema.Array(PublicAiSchema));
const ConnectionListSchema = Schema.mutable(Schema.Array(ConnectionSchema));

function parsePublicAi(value: unknown): PublicAi | null {
  const decoded = Schema.decodeUnknownExit(PublicAiSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parsePublicAiList(value: unknown): PublicAi[] | null {
  const decoded = Schema.decodeUnknownExit(PublicAiListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseConnectionList(value: unknown): Connection[] | null {
  const decoded = Schema.decodeUnknownExit(ConnectionListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// delete answers 204 with no body; any 2xx body is accepted and ignored,
// exactly like the old hand validator.
function parseDelete(value: unknown): undefined | null {
  const decoded = Schema.decodeUnknownExit(Schema.Unknown)(value);
  return Exit.isSuccess(decoded) ? undefined : null;
}

/** The exact POST body the server's strict `CreateAiSchema` accepts. */
export function buildCreateBody(input: CreateAiInput): Record<string, unknown> {
  return {
    name: input.name,
    template: input.template,
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    providerConnectionId: input.providerConnectionId,
    model: input.model,
    limits: input.limits,
  };
}

// The internal failures, one per case. They carry no field beyond what the old
// `AisApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class AisNetworkError extends Data.TaggedError('AisNetworkError') {}
class AisRequestError extends Data.TaggedError('AisRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class AisUnauthorized extends Data.TaggedError('AisUnauthorized') {}
class AisInvalidResponse extends Data.TaggedError('AisInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, AisNetworkError | AisRequestError> {
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
    catch: () => new AisNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new AisRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `AisApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createAisApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AisApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    AisUnauthorized | AisNetworkError | AisRequestError | AisInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new AisUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new AisInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          AisUnauthorized: () => Effect.fail(new AisApiError(401, 'unauthorized', 'No session')),
          AisNetworkError: () =>
            Effect.fail(new AisApiError(0, 'network_error', 'Could not reach the server')),
          AisRequestError: (error) =>
            Effect.fail(new AisApiError(error.status, error.code, error.message)),
          AisInvalidResponse: () =>
            Effect.fail(
              new AisApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async listAis() {
      const body = await withToken('/api/ais', { method: 'GET' }, parsePublicAiList);
      return body as PublicAi[];
    },
    async createAi(input) {
      const body = await withToken(
        '/api/ais',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildCreateBody(input)),
        },
        parsePublicAi,
      );
      return body as PublicAi;
    },
    async updateAi(id, input) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parsePublicAi,
      );
      return body as PublicAi;
    },
    async deleteAi(id) {
      await withToken(`/api/ais/${encodeURIComponent(id)}`, { method: 'DELETE' }, parseDelete);
    },
    async listConnections() {
      const body = await withToken('/api/connections', { method: 'GET' }, parseConnectionList);
      return body as Connection[];
    },
    async stopAi(id) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(id)}/stop`,
        { method: 'POST' },
        parsePublicAi,
      );
      return body as PublicAi;
    },
    async resumeAi(id) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(id)}/resume`,
        { method: 'POST' },
        parsePublicAi,
      );
      return body as PublicAi;
    },
  };
}
