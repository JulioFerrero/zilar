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
 * The mobile twin of the web chat-folders client (`apps/web/src/lib/api.ts`,
 * T-0237): list, create, edit, reorder and delete the caller's folders, as a
 * Promise port over the client derived from the shared contract
 * (`@zilar/api-contract`, `chat-folders.ts`, T-0892). The list drops a row
 * whose shape or icon is unknown rather than failing the whole list; a write
 * whose answer is malformed throws `invalid_response`.
 */

/** The fields a new folder carries; the server defaults the chat lists. */
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

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const ChatFoldersApiError = ApiError;
export type ChatFoldersApiError = ApiError;

/** A folder row the server sent; malformed rows return null and are dropped. */
export function parseChatFolder(value: unknown): ChatFolder | null {
  const decoded = Schema.decodeUnknownExit(ChatFolderSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/** The production `ChatFoldersApi`: bearer auth, `fetch`, the build API URL. */
export function createChatFoldersApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatFoldersApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listChatFolders: () => runApi(client.chatFolders.list()).then((body) => [...body.folders]),
    // The server trims `name`; the contract encodes the trimmed form.
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
