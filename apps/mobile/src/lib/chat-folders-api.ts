import { Exit, Schema } from 'effect';
import {
  ApiError,
  ChatFolder as ChatFolderSchema,
  omitUndefined,
  runApi,
} from '@zilar/api-contract';
import type { ChatFolder, FolderChatType, FolderIcon } from '@zilar/chat-core';

import { createApiClient } from './effect/api-client';
import { API_URL } from './auth';

/**
 * An unknown row is dropped rather than failing the whole list; a malformed write answer throws `invalid_response`.
 */

export interface CreateChatFolderInput {
  name: string;
  icon: FolderIcon;
  includeTypes?: FolderChatType[] | undefined;
  includeChats?: string[] | undefined;
  excludeChats?: string[] | undefined;
  excludeMuted?: boolean | undefined;
  excludeRead?: boolean | undefined;
}

export type PatchChatFolderInput = Partial<CreateChatFolderInput>;

export interface ChatFoldersApi {
  listChatFolders(): Promise<ChatFolder[]>;
  createChatFolder(input: CreateChatFolderInput): Promise<ChatFolder>;
  patchChatFolder(id: string, input: PatchChatFolderInput): Promise<ChatFolder>;
  reorderChatFolders(ids: string[]): Promise<ChatFolder[]>;
  deleteChatFolder(id: string): Promise<void>;
}

export const ChatFoldersApiError = ApiError;
export type ChatFoldersApiError = ApiError;

export function parseChatFolder(value: unknown): ChatFolder | null {
  const decoded = Schema.decodeUnknownExit(ChatFolderSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function createChatFoldersApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatFoldersApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listChatFolders: () => runApi(client.chatFolders.list()).then((body) => [...body.folders]),
    createChatFolder: (input) =>
      runApi(
        client.chatFolders.create({
          payload: { ...omitUndefined(input), name: input.name.trim() },
        }),
      ).then((body) => body.folder),
    patchChatFolder: (id, input) =>
      runApi(
        client.chatFolders.update({
          params: { id },
          payload: {
            ...omitUndefined(input),
            ...(input.name === undefined ? {} : { name: input.name.trim() }),
          },
        }),
      ).then((body) => body.folder),
    reorderChatFolders: (ids) =>
      runApi(client.chatFolders.order({ payload: { ids } })).then((body) => [...body.folders]),
    deleteChatFolder: async (id) => {
      await runApi(client.chatFolders.remove({ params: { id } }));
    },
  };
}
