import {
  makeChatsApi,
  type CreateChatFolderInput,
  type PatchChatFolderInput,
} from '@zilar/client-core';
import type { ChatFolder } from '@zilar/chat-core';

import type { ApiCall } from './effect/api-client';

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

export function makeChatFoldersApi(call: ApiCall): ChatFoldersApi {
  const api = makeChatsApi(call);
  return {
    listChatFolders: api.listChatFolders,
    createChatFolder: api.createChatFolder,
    patchChatFolder: api.patchChatFolder,
    reorderChatFolders: api.reorderChatFolders,
    deleteChatFolder: api.deleteChatFolder,
  };
}
