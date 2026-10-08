import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The mobile twin of the web chat-prefs client
 * (`apps/web/src/lib/api.ts`): list and set the caller's per-user prefs.
 * The wire contract lives in `apps/server/src/chat-prefs/routes.ts` and
 * `service.ts` (T-0113).
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. Muting a group covers its topics: the pref sits on the
 * General room JID and the client applies it to every topic unless the topic
 * has its own row.
 */

export interface ChatPref {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
}

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
}

export interface ChatPrefsApi {
  listChatPrefs(): Promise<ChatPref[]>;
  /** Answers the saved row, or null when the write landed on defaults. */
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
}

export class ChatPrefsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatPrefsApiError';
    this.status = status;
    this.code = code;
  }
}

const ChatPrefSchema = struct({
  chatJid: Schema.String,
  mutedUntil: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  pinnedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

const ChatPrefsListSchema = struct({
  prefs: Schema.mutable(Schema.Array(ChatPrefSchema)),
});

// `{ prefs: null }` is the write landing on all defaults (the row is deleted).
const DeletedPrefsSchema = struct({
  prefs: Schema.Null,
});

/** A pref row the server sent; malformed rows return null and are dropped. */
export function parseChatPref(value: unknown): ChatPref | null {
  const decoded = Schema.decodeUnknownExit(ChatPrefSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseChatPrefsList(value: unknown): ChatPref[] | null {
  const decoded = Schema.decodeUnknownExit(ChatPrefsListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value.prefs : null;
}

function parsePutChatPref(value: unknown): ChatPref | 'deleted' | null {
  const deleted = Schema.decodeUnknownExit(DeletedPrefsSchema)(value);
  if (Exit.isSuccess(deleted)) return 'deleted';
  return parseChatPref(value);
}

// The internal failures, one per case. They carry no field beyond what the old
// `ChatPrefsApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class ChatPrefsNetworkError extends Data.TaggedError('ChatPrefsNetworkError') {}
class ChatPrefsRequestError extends Data.TaggedError('ChatPrefsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ChatPrefsUnauthorized extends Data.TaggedError('ChatPrefsUnauthorized') {}
class ChatPrefsInvalidResponse extends Data.TaggedError('ChatPrefsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ChatPrefsNetworkError | ChatPrefsRequestError> {
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
    catch: () => new ChatPrefsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new ChatPrefsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `ChatPrefsApi`: bearer auth, `fetch`, the build API URL. */
export function createChatPrefsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatPrefsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ChatPrefsUnauthorized | ChatPrefsNetworkError | ChatPrefsRequestError | ChatPrefsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ChatPrefsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ChatPrefsInvalidResponse();
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
          ChatPrefsUnauthorized: () =>
            Effect.fail(new ChatPrefsApiError(401, 'unauthorized', 'No session')),
          ChatPrefsNetworkError: () =>
            Effect.fail(new ChatPrefsApiError(0, 'network_error', 'Could not reach the server')),
          ChatPrefsRequestError: (error) =>
            Effect.fail(new ChatPrefsApiError(error.status, error.code, error.message)),
          ChatPrefsInvalidResponse: () =>
            Effect.fail(
              new ChatPrefsApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async listChatPrefs() {
      const body = await withToken('/api/chat-prefs', { method: 'GET' }, parseChatPrefsList);
      return body as ChatPref[];
    },
    async putChatPref(chatJid, input) {
      const body = await withToken(
        `/api/chat-prefs/${encodeURIComponent(chatJid)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parsePutChatPref,
      );
      return body === 'deleted' ? null : (body as ChatPref);
    },
  };
}
