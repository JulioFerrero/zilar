import { Data, Effect, type Effect as EffectType } from 'effect';
import {
  ApiError,
  runApi,
  type ChatEntry as ContractChatEntry,
  type Contact as ContractContact,
  type GroupAi as ContractGroupAi,
  type GroupDetail as ContractGroupDetail,
  type GroupMember as ContractGroupMember,
  type LinkPreview as ContractLinkPreview,
} from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import type { Me } from './auth-api';
import { errorFieldsOf } from './api-error-body';
import { parseChatsList, parseGroupDetail, parseMe, parseXmppToken } from './chat-api-schemas';

export type { Me };

/**
 * Validated at the boundary with Effect Schema; each request is an Effect pipeline, cut to a `Promise` at the edge.
 */

export type Contact = ContractContact;

export type LinkPreview = ContractLinkPreview;

export type ChatEntry = ContractChatEntry;

export type GroupRole = 'owner' | 'admin' | 'member';

// The contract's `GroupMember.handle` is `string | null`; mobile normalizes null to absent, narrowing it back to `string | undefined`.
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

export type TokenProvider = () => Promise<string | undefined>;

export interface ChatApi {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  /** `null` when the server answers 204 or the call fails; optional so fakes keep working. */
  linkPreview?(url: string): Promise<LinkPreview | null>;
  markChatRead?(jid: string, messageId: string): Promise<void>;
  markChatDelivered?(jid: string, originIds: string[]): Promise<void>;
  /**
   * Optional so fakes keep working; the id is the archive id.
   */
  deleteMessageForMe?(jid: string, archiveId: string): Promise<void>;
  /**
   * Optional for fakes.
   */
  clearChatHistory?(jid: string): Promise<void>;
}

// The `Promise` edge maps each internal failure back to the same error, status, code and message.
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
        credentials: 'omit',
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
          ChatUnauthorized: () => Effect.fail(new ApiError(401, 'unauthorized', 'No session')),
          ChatNetworkError: () =>
            Effect.fail(new ApiError(0, 'network_error', 'Could not reach the server')),
          ChatRequestError: (error) =>
            Effect.fail(new ApiError(error.status, error.code, error.message)),
          ChatInvalidResponse: () =>
            Effect.fail(
              new ApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async getMe() {
      return (await withToken('/api/me', { method: 'GET' }, parseMe)) as Me;
    },
    async getChats() {
      // One malformed entry fails the whole list.
      const body = await runApi(client.chats.list());
      const chats = parseChatsList(body);
      if (chats === null) {
        throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
      }
      return chats;
    },
    getContacts: () => runApi(client.contacts.list()).then((rows) => [...rows]),
    // The server answers 204 when the page has nothing; the derived client then yields `null`. A transport failure rejects, and the card treats it as `null` too.
    linkPreview: (url) =>
      runApi(client.linkPreview.get({ query: { url } })).then((value) => value ?? null),
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
    // `messageId` must be the archive id (numeric), else the server answers 400; best effort, callers ignore failures.
    async markChatRead(jid: string, messageId: string) {
      await runApi(client.chats.markRead({ params: { jid }, payload: { messageId } }));
    },
    // `originIds` are origin ids, 1 to 50 per call; best effort.
    async markChatDelivered(jid: string, originIds: string[]) {
      await runApi(client.chats.markDelivered({ params: { jid }, payload: { originIds } }));
    },
    // The server rejects a non-numeric archive id.
    async deleteMessageForMe(jid: string, archiveId: string) {
      await runApi(client.chats.deleteForMe({ params: { jid, archiveId } }));
    },
    async clearChatHistory(jid: string) {
      await runApi(client.chats.clearHistory({ params: { jid } }));
    },
  };
}
