import { Exit, Schema } from 'effect';
import { ApiError, ChatPref as ChatPrefSchema, omitUndefined, runApi } from '@zilar/api-contract';

import { createApiClient } from './effect/api-client';
import { API_URL } from './auth';

/**
 * Muting a group covers its topics: the pref sits on the General room JID and applies to every topic unless the topic has its own row.
 */

export interface ChatPref {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  unreadMark?: boolean | undefined;
  updatedAt: string;
}

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  unreadMark?: boolean | undefined;
}

export interface ChatPrefsApi {
  listChatPrefs(): Promise<ChatPref[]>;
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
}

export const ChatPrefsApiError = ApiError;
export type ChatPrefsApiError = ApiError;

export function parseChatPref(value: unknown): ChatPref | null {
  const decoded = Schema.decodeUnknownExit(ChatPrefSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function createChatPrefsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatPrefsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listChatPrefs: () => runApi(client.chatPrefs.list()).then((body) => [...body.prefs]),
    putChatPref: (chatJid, input) =>
      runApi(client.chatPrefs.putPref({ params: { chatJid }, payload: omitUndefined(input) })).then(
        (saved) => ('prefs' in saved ? null : saved),
      ),
  };
}
