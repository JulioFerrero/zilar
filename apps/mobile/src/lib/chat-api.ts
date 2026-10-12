import { Data, Effect, type Effect as EffectType } from 'effect';
import {
  ApiError,
  runApi,
  type ChatEntry as ContractChatEntry,
  type Contact as ContractContact,
  type GroupAi as ContractGroupAi,
  type GroupDetail as ContractGroupDetail,
  type GroupMember as ContractGroupMember,
} from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import type { Me } from './auth-api';
import { errorFieldsOf } from './api-error-body';
import { parseChatsList, parseGroupDetail, parseMe, parseXmppToken } from './chat-api-schemas';

export type { Me };

/**
 * The server APIs the real chat store needs, validated at the boundary with
 * Effect Schema (T-0551, the T-0506 recipe). The session token comes from a
 * `TokenProvider` so tests can inject a fake. The request is an Effect
 * pipeline, cut back to a `Promise` at the edge with `Effect.runPromise`.
 */

export type Contact = ContractContact;

// T-0924: the entry type comes from the API contract, the same union web
// decodes. `parseChatEntry` (in `chat-api-schemas`) still decodes each entry on
// its own and skips a bad one, so the mobile leniency (audit F5) is unchanged.
export type ChatEntry = ContractChatEntry;

export type GroupRole = 'owner' | 'admin' | 'member';

// T-0920: the group detail types come from the API contract, the same source
// the web app reads, so mobile stops declaring its own. The contract's
// `GroupMember.handle` is `string | null` (the wire sends null when unset);
// mobile normalizes null to absent, so the member type narrows that one field
// back to `string | undefined` (the Report lists the difference).
export type GroupMember = Omit<ContractGroupMember, 'handle'> & { handle?: string };
export type GroupDetail = Omit<ContractGroupDetail, 'members'> & { members: GroupMember[] };
export type GroupAi = ContractGroupAi;

export interface XmppToken {
  jid: string;
  token: string;
  expiresAt: string;
  service: string;
  domain: string;
  mucDomain: string;
}

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

export interface ChatApi {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  /** Stores the caller's read mark (T-1207). Optional so fakes keep working. */
  markChatRead?(jid: string, messageId: string): Promise<void>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const ChatApiError = ApiError;
export type ChatApiError = ApiError;

// The internal failures, one per case. They carry no field beyond what the old
// `ChatApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class ChatNetworkError extends Data.TaggedError('ChatNetworkError') {}
class ChatRequestError extends Data.TaggedError('ChatRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ChatUnauthorized extends Data.TaggedError('ChatUnauthorized') {}
class ChatInvalidResponse extends Data.TaggedError('ChatInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ChatNetworkError | ChatRequestError> {
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
    catch: () => new ChatNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new ChatRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `ChatApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createChatApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ChatUnauthorized | ChatNetworkError | ChatRequestError | ChatInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ChatUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ChatInvalidResponse();
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
          ChatUnauthorized: () => Effect.fail(new ChatApiError(401, 'unauthorized', 'No session')),
          ChatNetworkError: () =>
            Effect.fail(new ChatApiError(0, 'network_error', 'Could not reach the server')),
          ChatRequestError: (error) =>
            Effect.fail(new ChatApiError(error.status, error.code, error.message)),
          ChatInvalidResponse: () =>
            Effect.fail(
              new ChatApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async getMe() {
      return (await withToken('/api/me', { method: 'GET' }, parseMe)) as Me;
    },
    async getChats() {
      // The contract passes the entries through as `unknown`; they are
      // validated here, and one malformed entry fails the whole list.
      const body = await runApi(client.chats.list());
      const chats = parseChatsList(body);
      if (chats === null) {
        throw new ChatApiError(200, 'invalid_response', 'The server sent an unexpected response');
      }
      return chats;
    },
    getContacts: () => runApi(client.contacts.list()).then((rows) => [...rows]),
    async getGroup(groupId) {
      return (await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        { method: 'GET' },
        parseGroupDetail,
      )) as GroupDetail;
    },
    async getXmppToken() {
      return (await withToken('/api/xmpp/token', { method: 'POST' }, parseXmppToken)) as XmppToken;
    },
    // Stores the caller's read mark (T-1207): `messageId` must be the archive
    // id (numeric) — the server answers 400 otherwise, surfaced as
    // `ChatApiError`. Best effort: callers ignore failures.
    async markChatRead(jid: string, messageId: string) {
      await runApi(client.chats.markRead({ params: { jid }, payload: { messageId } }));
    },
  };
}
