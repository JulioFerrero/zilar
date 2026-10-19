import type { ChatPref as ContractChatPref } from '@zilar/api-contract';
import { makeChatsApi, type PutChatPrefInput } from '@zilar/client-core';

import type { ApiCall } from './effect/api-client';

/**
 * Muting a group covers its topics: the pref sits on the General room JID and applies to every topic unless the topic has its own row.
 */

export type ChatPref = ContractChatPref;

export type { PutChatPrefInput };

export interface ChatPrefsApi {
  listChatPrefs(): Promise<ChatPref[]>;
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
}

export function makeChatPrefsApi(call: ApiCall): ChatPrefsApi {
  const api = makeChatsApi(call);
  return {
    listChatPrefs: api.listChatPrefs,
    putChatPref: api.putChatPref,
  };
}
