import { runApi, type ChatPref as ContractChatPref } from '@zilar/api-contract';
import { makeChatsApi, type PutChatPrefInput } from '@zilar/client-core';

import { createApiClient } from './effect/api-client';
import { API_URL } from './auth';

/**
 * Muting a group covers its topics: the pref sits on the General room JID and applies to every topic unless the topic has its own row.
 */

export type ChatPref = ContractChatPref;

export type { PutChatPrefInput };

export interface ChatPrefsApi {
  listChatPrefs(): Promise<ChatPref[]>;
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
}

export function createChatPrefsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatPrefsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeChatsApi((call) => runApi(call(client)));
  return {
    listChatPrefs: api.listChatPrefs,
    putChatPref: api.putChatPref,
  };
}
