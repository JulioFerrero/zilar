import { runApi } from '@zilar/api-contract';
import {
  makeChatsApi,
  type CreateChatFolderInput,
  type PatchChatFolderInput,
} from '@zilar/client-core';
import type { ChatFolder } from '@zilar/chat-core';

import { createApiClient } from './effect/api-client';
import { API_URL } from './auth';

/**
 * An unknown row is dropped by the contract's list schema rather than failing the whole list; a malformed write answer throws `invalid_response`.
 */

export type { CreateChatFolderInput, PatchChatFolderInput };

export interface ChatFoldersApi {
  listChatFolders(): Promise<ChatFolder[]>;
  createChatFolder(input: CreateChatFolderInput): Promise<ChatFolder>;
  patchChatFolder(id: string, input: PatchChatFolderInput): Promise<ChatFolder>;
  reorderChatFolders(ids: string[]): Promise<ChatFolder[]>;
  deleteChatFolder(id: string): Promise<void>;
}

export function createChatFoldersApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatFoldersApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeChatsApi((call) => runApi(call(client)));
  return {
    listChatFolders: api.listChatFolders,
    createChatFolder: api.createChatFolder,
    patchChatFolder: api.patchChatFolder,
    reorderChatFolders: api.reorderChatFolders,
    deleteChatFolder: api.deleteChatFolder,
  };
}
