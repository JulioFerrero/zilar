import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';

/**
 * The model provider connections API (`/api/connections`), the mobile twin
 * of the web client in `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/connections/routes.ts`.
 *
 * An API key is write-only: the server never returns one, and this module
 * never stores one. The key travels only in the POST body of
 * `createConnection` and is dropped by the caller right after.
 *
 * The boundary is validated with Effect Schema (T-0527, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `ConnectionsApiError` keeps the server's `code` and
 * `status`, so screens can branch on the error without parsing the message
 * again. Never log a request body: it carries the provider key.
 */

export interface ProviderConnection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  createdAt: string;
}

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export interface ConnectionsApi {
  listConnections(): Promise<ProviderConnection[]>;
  createConnection(input: CreateConnectionInput): Promise<ProviderConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  deleteConnection(id: string): Promise<void>;
}

export class ConnectionsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ConnectionsApiError';
    this.status = status;
    this.code = code;
  }
}

// A lenient field: a missing, `undefined` or non-string label decodes to
// `null` instead of failing the row, exactly like the old type guard. The key
// may be absent (server rows omit it when there is no label).
const LenientLabelSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const ProviderConnectionSchema = struct({
  id: Schema.String,
  provider: Schema.String,
  label: LenientLabelSchema,
  status: Schema.String,
  createdAt: Schema.String,
});

// The list is a bare array (not an envelope); `Array` is made mutable to keep
// the `ProviderConnection[]` type the API has always returned.
const ConnectionListSchema = Schema.mutable(Schema.Array(ProviderConnectionSchema));

const TestResultSchema = struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
});

// The server's error envelope. A missing or malformed envelope keeps the fixed
// fallbacks used by `requestEffect`.
const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

function parseConnection(value: unknown): ProviderConnection | null {
  const decoded = Schema.decodeUnknownExit(ProviderConnectionSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseTestResult(value: unknown): ConnectionTestResult | null {
  const decoded = Schema.decodeUnknownExit(TestResultSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/** The exact POST body the server's strict `CreateConnectionSchema` accepts. */
export function buildCreateConnectionBody(input: CreateConnectionInput): Record<string, unknown> {
  return {
    provider: input.provider,
    key: input.key,
    ...(input.label === undefined ? {} : { label: input.label }),
  };
}

// The internal failures, one per case. They carry no field beyond what the old
// `ConnectionsApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class ConnectionsNetworkError extends Data.TaggedError('ConnectionsNetworkError') {}
class ConnectionsRequestError extends Data.TaggedError('ConnectionsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ConnectionsUnauthorized extends Data.TaggedError('ConnectionsUnauthorized') {}
class ConnectionsInvalidResponse extends Data.TaggedError('ConnectionsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ConnectionsNetworkError | ConnectionsRequestError> {
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
    catch: () => new ConnectionsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const decoded = Schema.decodeUnknownExit(ErrorBodySchema)(body);
    const error = Exit.isSuccess(decoded) ? decoded.value.error : undefined;
    return yield* new ConnectionsRequestError({
      status: response.status,
      code: error?.code ?? 'request_failed',
      message: error?.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `ConnectionsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createConnectionsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ConnectionsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    | ConnectionsUnauthorized
    | ConnectionsNetworkError
    | ConnectionsRequestError
    | ConnectionsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ConnectionsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ConnectionsInvalidResponse();
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
          ConnectionsUnauthorized: () =>
            Effect.fail(new ConnectionsApiError(401, 'unauthorized', 'No session')),
          ConnectionsNetworkError: () =>
            Effect.fail(new ConnectionsApiError(0, 'network_error', 'Could not reach the server')),
          ConnectionsRequestError: (error) =>
            Effect.fail(new ConnectionsApiError(error.status, error.code, error.message)),
          ConnectionsInvalidResponse: () =>
            Effect.fail(
              new ConnectionsApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  const parseList = (value: unknown): ProviderConnection[] | null => {
    const decoded = Schema.decodeUnknownExit(ConnectionListSchema)(value);
    return Exit.isSuccess(decoded) ? decoded.value : null;
  };

  return {
    async listConnections() {
      const body = await withToken('/api/connections', { method: 'GET' }, parseList);
      return body as ProviderConnection[];
    },
    async createConnection(input) {
      const body = await withToken(
        '/api/connections',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildCreateConnectionBody(input)),
        },
        parseConnection,
      );
      return body as ProviderConnection;
    },
    async testConnection(id) {
      const body = await withToken(
        `/api/connections/${encodeURIComponent(id)}/test`,
        { method: 'POST' },
        parseTestResult,
      );
      return body as ConnectionTestResult;
    },
    async deleteConnection(id) {
      await withToken(
        `/api/connections/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        () => undefined,
      );
    },
  };
}
