import { Exit, Schema } from 'effect';
import { ApiError, ChatPref as ChatPrefSchema, omitUndefined, runApi } from '@zilar/api-contract';

import { createApiClient } from './effect/api-client';
import { API_URL } from './auth';

/**
 * The mobile twin of the web chat-prefs client
 * (`apps/web/src/lib/api.ts`): list and set the caller's per-user prefs, as a
 * Promise port over the client derived from the shared contract
 * (`@zilar/api-contract`, `chat-prefs.ts`, T-0892). Muting a group covers its
 * topics: the pref sits on the General room JID and the client applies it to
 * every topic unless the topic has its own row.
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

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const ChatPrefsApiError = ApiError;
export type ChatPrefsApiError = ApiError;

/** A pref row the server sent; malformed rows return null and are dropped. */
export function parseChatPref(value: unknown): ChatPref | null {
  const decoded = Schema.decodeUnknownExit(ChatPrefSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/** The production `ChatPrefsApi`: bearer auth, `fetch`, the build API URL. */
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
