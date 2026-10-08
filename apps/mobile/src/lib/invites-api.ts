import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The personal-invite API (`POST /api/invites`), the mobile twin of the web
 * client (`createInvite()` in `apps/web/src/lib/api.ts`). The wire contract
 * lives in `apps/server/src/auth/routes.ts` (answers
 * `{ code, url, expiresAt }`, session required).
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `InvitesApiError` keeps the server's `code` and
 * `status`, so the sheet can branch on the error without parsing the message
 * again.
 */

export interface Invite {
  code: string;
  url: string;
  expiresAt?: string | undefined;
}

export interface InvitesApi {
  createInvite(): Promise<Invite>;
}

export class InvitesApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'InvitesApiError';
    this.status = status;
    this.code = code;
  }
}

const InviteSchema = struct({
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.optional(Schema.String),
});

/** An invite the server sent; a malformed body returns null. */
function parseInvite(value: unknown): Invite | null {
  const decoded = Schema.decodeUnknownExit(InviteSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `InvitesApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class InvitesNetworkError extends Data.TaggedError('InvitesNetworkError') {}
class InvitesRequestError extends Data.TaggedError('InvitesRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class InvitesUnauthorized extends Data.TaggedError('InvitesUnauthorized') {}
class InvitesInvalidResponse extends Data.TaggedError('InvitesInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, InvitesNetworkError | InvitesRequestError> {
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
    catch: () => new InvitesNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new InvitesRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `InvitesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createInvitesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InvitesApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    InvitesUnauthorized | InvitesNetworkError | InvitesRequestError | InvitesInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new InvitesUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new InvitesInvalidResponse();
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
          InvitesUnauthorized: () =>
            Effect.fail(new InvitesApiError(401, 'unauthorized', 'No session')),
          InvitesNetworkError: () =>
            Effect.fail(new InvitesApiError(0, 'network_error', 'Could not reach the server')),
          InvitesRequestError: (error) =>
            Effect.fail(new InvitesApiError(error.status, error.code, error.message)),
          InvitesInvalidResponse: () =>
            Effect.fail(
              new InvitesApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async createInvite() {
      const body = await withToken('/api/invites', { method: 'POST' }, parseInvite);
      return body as Invite;
    },
  };
}
