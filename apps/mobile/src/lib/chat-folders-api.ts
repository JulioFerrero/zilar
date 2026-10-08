import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import {
  FOLDER_ICONS,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The mobile twin of the web chat-folders client (`apps/web/src/lib/api.ts`,
 * T-0237): list, create, edit, reorder and delete the caller's folders. The
 * wire contract lives in `apps/server/src/chat-folders/api.ts` (T-0232).
 *
 * The boundary is validated with Effect Schema (T-0541, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge
 * with `Effect.runPromise`. The list drops a row whose shape or icon is
 * unknown rather than failing the whole list; a write whose answer is
 * malformed throws `invalid_response`.
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

export class ChatFoldersApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatFoldersApiError';
    this.status = status;
    this.code = code;
  }
}

const FolderIconSchema = Schema.Literals(FOLDER_ICONS);

const FolderChatTypeSchema = Schema.Literals(['dm', 'group', 'channel', 'ai']);

const ChatFolderSchema = struct({
  id: Schema.String,
  name: Schema.String,
  icon: FolderIconSchema,
  position: Schema.Finite,
  includeTypes: Schema.mutable(Schema.Array(FolderChatTypeSchema)),
  includeChats: Schema.mutable(Schema.Array(Schema.String)),
  excludeChats: Schema.mutable(Schema.Array(Schema.String)),
  excludeMuted: Schema.Boolean,
  excludeRead: Schema.Boolean,
});

// The list and order envelopes carry rows as `unknown`: one malformed row is
// dropped from the list, while a write answers with one authoritative row.
const FolderListEnvelopeSchema = struct({
  folders: Schema.mutable(Schema.Array(Schema.Unknown)),
});

const FolderRowEnvelopeSchema = struct({
  folder: Schema.Unknown,
});

const FolderDeleteEnvelopeSchema = struct({
  deleted: Schema.Boolean,
});

/** A folder row the server sent; malformed rows return null and are dropped. */
export function parseChatFolder(value: unknown): ChatFolder | null {
  const decoded = Schema.decodeUnknownExit(ChatFolderSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function invalidResponse(): ChatFoldersApiError {
  return new ChatFoldersApiError(200, 'invalid_response', 'The server sent an unexpected response');
}

/** Drops malformed rows, the list endpoint's long-standing behaviour. */
function parseFolderRows(entries: unknown[]): ChatFolder[] {
  const folders: ChatFolder[] = [];
  for (const entry of entries) {
    const folder = parseChatFolder(entry);
    if (folder !== null) {
      folders.push(folder);
    }
  }
  return folders;
}

/** A write answers with one authoritative row: a bad shape is a broken server. */
function parseFolderRow(value: unknown): ChatFolder {
  const folder = parseChatFolder(value);
  if (folder === null) {
    throw invalidResponse();
  }
  return folder;
}

function parseFolderList(value: unknown): ChatFolder[] | null {
  const decoded = Schema.decodeUnknownExit(FolderListEnvelopeSchema)(value);
  return Exit.isSuccess(decoded) ? parseFolderRows(decoded.value.folders) : null;
}

function parseFolderWrite(value: unknown): ChatFolder | null {
  const decoded = Schema.decodeUnknownExit(FolderRowEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  try {
    return parseFolderRow(decoded.value.folder);
  } catch {
    return null;
  }
}

function parseFolderOrder(value: unknown): ChatFolder[] | null {
  const decoded = Schema.decodeUnknownExit(FolderListEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  try {
    return decoded.value.folders.map(parseFolderRow);
  } catch {
    return null;
  }
}

function parseFolderDelete(value: unknown): Record<string, unknown> | null {
  const decoded = Schema.decodeUnknownExit(FolderDeleteEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded) || decoded.value.deleted !== true) return null;
  return {};
}

// The internal failures, one per case. They carry no field beyond what the
// old `ChatFoldersApiError` already surfaced; the `Promise` edge maps each
// back to that same error, status, code and message.
class ChatFoldersNetworkError extends Data.TaggedError('ChatFoldersNetworkError') {}
class ChatFoldersRequestError extends Data.TaggedError('ChatFoldersRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ChatFoldersUnauthorized extends Data.TaggedError('ChatFoldersUnauthorized') {}
class ChatFoldersInvalidResponse extends Data.TaggedError('ChatFoldersInvalidResponse') {}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  options?: RequestOptions,
): EffectType.fn.Return<unknown, ChatFoldersNetworkError | ChatFoldersRequestError> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
  let body: string | undefined;
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        method: options?.method ?? 'GET',
        headers,
        signal,
        ...(body === undefined ? {} : { body }),
      }),
    catch: () => new ChatFoldersNetworkError(),
  });

  const responseBody: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(responseBody);
    return yield* new ChatFoldersRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return responseBody;
});

/** The production `ChatFoldersApi`: bearer auth, `fetch`, the build API URL. */
export function createChatFoldersApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatFoldersApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    options: RequestOptions | undefined,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    | ChatFoldersUnauthorized
    | ChatFoldersNetworkError
    | ChatFoldersRequestError
    | ChatFoldersInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ChatFoldersUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, fetchImpl, options);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ChatFoldersInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    options: RequestOptions | undefined,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, options, parse).pipe(
        Effect.catchTags({
          ChatFoldersUnauthorized: () =>
            Effect.fail(new ChatFoldersApiError(401, 'unauthorized', 'No session')),
          ChatFoldersNetworkError: () =>
            Effect.fail(new ChatFoldersApiError(0, 'network_error', 'Could not reach the server')),
          ChatFoldersRequestError: (error) =>
            Effect.fail(new ChatFoldersApiError(error.status, error.code, error.message)),
          ChatFoldersInvalidResponse: () => Effect.fail(invalidResponse()),
        }),
      ),
    );

  return {
    async listChatFolders() {
      const body = await withToken('/api/chat-folders', undefined, parseFolderList);
      return body as ChatFolder[];
    },

    async createChatFolder(input) {
      const body = await withToken(
        '/api/chat-folders',
        { method: 'POST', body: input },
        parseFolderWrite,
      );
      return body as ChatFolder;
    },

    async patchChatFolder(id, input) {
      const body = await withToken(
        `/api/chat-folders/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: input },
        parseFolderWrite,
      );
      return body as ChatFolder;
    },

    async reorderChatFolders(ids) {
      const body = await withToken(
        '/api/chat-folders/order',
        { method: 'PUT', body: { ids } },
        parseFolderOrder,
      );
      return body as ChatFolder[];
    },

    async deleteChatFolder(id) {
      await withToken(
        `/api/chat-folders/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        parseFolderDelete,
      );
    },
  };
}
