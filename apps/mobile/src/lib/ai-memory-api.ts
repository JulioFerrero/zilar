import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The AI memory API (`GET /api/ai-memory`, `DELETE /api/ai-memory/facts/:id`
 * and `POST /api/ai-memory/clear`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/agents/memory/routes.ts`.
 *
 * The boundary is validated with Effect Schema (T-0527, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `AiMemoryApiError` keeps the server's `code` and
 * `status`, so the section can show fixed user-facing sentences instead of
 * server text.
 */

export interface AiMemoryFact {
  id: string;
  text: string;
}

export interface AiMemory {
  facts: AiMemoryFact[];
  lines: string[];
  canChange: boolean;
}

export interface AiMemoryApi {
  getMemory(chat: string, aiId: string): Promise<AiMemory>;
  forgetFact(chat: string, aiId: string, factId: string): Promise<void>;
  clear(chat: string, aiId: string): Promise<void>;
}

export class AiMemoryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AiMemoryApiError';
    this.status = status;
    this.code = code;
  }
}

const FactSchema = struct({
  id: Schema.String,
  text: Schema.String,
});

// `Array` is made mutable to keep the `AiMemoryFact[]` / `string[]` types the
// API has always returned.
const MemorySchema = struct({
  facts: Schema.mutable(Schema.Array(FactSchema)),
  lines: Schema.mutable(Schema.Array(Schema.String)),
  canChange: Schema.Boolean,
});

function parseAiMemory(value: unknown): AiMemory | null {
  const decoded = Schema.decodeUnknownExit(MemorySchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `AiMemoryApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class AiMemoryNetworkError extends Data.TaggedError('AiMemoryNetworkError') {}
class AiMemoryRequestError extends Data.TaggedError('AiMemoryRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class AiMemoryUnauthorized extends Data.TaggedError('AiMemoryUnauthorized') {}
class AiMemoryInvalidResponse extends Data.TaggedError('AiMemoryInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, AiMemoryNetworkError | AiMemoryRequestError> {
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
    catch: () => new AiMemoryNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new AiMemoryRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `AiMemoryApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createAiMemoryApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiMemoryApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    AiMemoryUnauthorized | AiMemoryNetworkError | AiMemoryRequestError | AiMemoryInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new AiMemoryUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new AiMemoryInvalidResponse();
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
          AiMemoryUnauthorized: () =>
            Effect.fail(new AiMemoryApiError(401, 'unauthorized', 'No session')),
          AiMemoryNetworkError: () =>
            Effect.fail(new AiMemoryApiError(0, 'network_error', 'Could not reach the server')),
          AiMemoryRequestError: (error) =>
            Effect.fail(new AiMemoryApiError(error.status, error.code, error.message)),
          AiMemoryInvalidResponse: () =>
            Effect.fail(
              new AiMemoryApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async getMemory(chat, aiId) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      params.set('ai', aiId);
      const body = await withToken(
        `/api/ai-memory?${params.toString()}`,
        { method: 'GET' },
        parseAiMemory,
      );
      return body as AiMemory;
    },

    async forgetFact(chat, aiId, factId) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      params.set('ai', aiId);
      await withToken(
        `/api/ai-memory/facts/${encodeURIComponent(factId)}?${params.toString()}`,
        { method: 'DELETE' },
        () => undefined,
      );
    },

    async clear(chat, aiId) {
      await withToken(
        '/api/ai-memory/clear',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat, ai: aiId }),
        },
        () => undefined,
      );
    },
  };
}
