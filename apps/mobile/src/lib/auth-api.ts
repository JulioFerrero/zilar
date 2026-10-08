import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';

/** The signed-in profile, from `GET /api/me` (T-0015/T-0020). */
export interface Me {
  id: string;
  email: string;
  name: string;
  jid: string | null;
}

/** A failed API call, carrying the status and the server's error code. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

// A lenient field: a missing or non-string `jid` decodes to `null` instead of
// failing the profile, exactly like the old type guard.
const LenientJidSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const MeSchema = struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  jid: LenientJidSchema,
});

function parseMe(value: unknown): Me | null {
  const decoded = Schema.decodeUnknownExit(MeSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The invite check answers a bare `{ valid: boolean }`; anything else,
// including a non-object body, means "not valid".
const InviteCheckSchema = struct({
  valid: Schema.optional(Schema.Boolean),
});

// The internal failures, one per case. They carry no field beyond what the old
// `AuthApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class AuthNetworkError extends Data.TaggedError('AuthNetworkError') {}
class AuthRequestError extends Data.TaggedError('AuthRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class AuthInvalidResponse extends Data.TaggedError('AuthInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, AuthNetworkError | AuthRequestError> {
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
    catch: () => new AuthNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new AuthRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

function runMeRequest(
  apiUrl: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  path: string,
): Promise<Me> {
  const effect = Effect.fnUntraced(function* (): EffectType.fn.Return<
    Me,
    AuthNetworkError | AuthRequestError | AuthInvalidResponse
  > {
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const me = parseMe(body);
    if (me === null) {
      return yield* new AuthInvalidResponse();
    }
    return me;
  });
  return Effect.runPromise(
    effect().pipe(
      Effect.catchTags({
        AuthNetworkError: () =>
          Effect.fail(new AuthApiError(0, 'network_error', 'Could not reach the server')),
        AuthRequestError: (error) =>
          Effect.fail(new AuthApiError(error.status, error.code, error.message)),
        AuthInvalidResponse: () =>
          Effect.fail(
            new AuthApiError(200, 'invalid_response', 'The server sent an unexpected response'),
          ),
      }),
    ),
  );
}

export async function fetchMe(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  return runMeRequest(apiUrl, token, { method: 'GET' }, fetchImpl, '/api/me');
}

export async function updateMe(
  apiUrl: string,
  token: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  return runMeRequest(
    apiUrl,
    token,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    fetchImpl,
    '/api/me',
  );
}

/** Checks an invite link without leaking anything about its creator. */
export async function checkInvite(
  apiUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const effect = Effect.fnUntraced(function* (): EffectType.fn.Return<boolean, AuthNetworkError> {
    const response = yield* Effect.tryPromise({
      // No `signal`: the test pins the exact `fetch` init for this call.
      try: () =>
        fetchImpl(`${apiUrl}/api/invites/${encodeURIComponent(code)}`, {
          headers: { accept: 'application/json' },
        }),
      catch: () => new AuthNetworkError(),
    });
    const body: unknown = yield* Effect.promise(
      () => response.json().catch(() => null) as Promise<unknown>,
    );
    if (!response.ok) {
      return false;
    }
    const decoded = Schema.decodeUnknownExit(InviteCheckSchema)(body);
    if (!Exit.isSuccess(decoded)) {
      return false;
    }
    return decoded.value.valid === true;
  });
  return Effect.runPromise(
    effect().pipe(
      Effect.catchTag('AuthNetworkError', () =>
        Effect.fail(new AuthApiError(0, 'network_error', 'Could not reach the server')),
      ),
    ),
  );
}
