import {
  FOLDER_ICONS,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';

import { API_URL } from './auth';

/**
 * The mobile twin of the web chat-folders client (`apps/web/src/lib/api.ts`,
 * T-0237): list, create, edit, reorder and delete the caller's folders. The
 * wire contract lives in `apps/server/src/chat-folders/routes.ts` (T-0232).
 *
 * Mobile has no zod, so — like `chat-prefs-api.ts` — the boundary is validated
 * with type guards. The list drops a row whose shape or icon is unknown rather
 * than failing the whole list; a write whose answer is malformed throws
 * `invalid_response`.
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

const CHAT_TYPES: readonly FolderChatType[] = ['dm', 'group', 'channel', 'ai'];
const FOLDER_ICON_NAMES = new Set<string>(FOLDER_ICONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFolderIcon(value: unknown): value is FolderIcon {
  return isString(value) && FOLDER_ICON_NAMES.has(value);
}

function isChatType(value: unknown): value is FolderChatType {
  return isString(value) && (CHAT_TYPES as readonly string[]).includes(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (!isString(entry)) return null;
    entries.push(entry);
  }
  return entries;
}

function chatTypeArray(value: unknown): FolderChatType[] | null {
  if (!Array.isArray(value)) return null;
  const types: FolderChatType[] = [];
  for (const entry of value) {
    if (!isChatType(entry)) return null;
    types.push(entry);
  }
  return types;
}

/** A folder row the server sent; malformed rows return null and are dropped. */
export function parseChatFolder(value: unknown): ChatFolder | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  const icon = value['icon'];
  const position = value['position'];
  const includeTypes = chatTypeArray(value['includeTypes']);
  const includeChats = stringArray(value['includeChats']);
  const excludeChats = stringArray(value['excludeChats']);
  const excludeMuted = value['excludeMuted'];
  const excludeRead = value['excludeRead'];
  if (
    !isString(id) ||
    !isString(name) ||
    !isFolderIcon(icon) ||
    typeof position !== 'number' ||
    !Number.isFinite(position) ||
    includeTypes === null ||
    includeChats === null ||
    excludeChats === null ||
    typeof excludeMuted !== 'boolean' ||
    typeof excludeRead !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    name,
    icon,
    position,
    includeTypes,
    includeChats,
    excludeChats,
    excludeMuted,
    excludeRead,
  };
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

async function requireToken(getToken: () => Promise<string | undefined>): Promise<string> {
  const token = await getToken();
  if (token === undefined) {
    throw new ChatFoldersApiError(401, 'unauthorized', 'No session');
  }
  return token;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  options?: RequestOptions,
): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
  let body: string | undefined;
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw new ChatFoldersApiError(0, 'network_error', 'Could not reach the server');
  }

  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      isRecord(responseBody) && isRecord(responseBody['error']) ? responseBody['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ChatFoldersApiError(response.status, code, message);
  }
  return responseBody;
}

/** The production `ChatFoldersApi`: bearer auth, `fetch`, the build API URL. */
export function createChatFoldersApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatFoldersApi {
  return {
    async listChatFolders() {
      const token = await requireToken(getToken);
      const body = await request(apiUrl, '/api/chat-folders', token, fetchImpl);
      if (!isRecord(body) || !Array.isArray(body['folders'])) {
        throw invalidResponse();
      }
      return parseFolderRows(body['folders']);
    },

    async createChatFolder(input) {
      const token = await requireToken(getToken);
      const body = await request(apiUrl, '/api/chat-folders', token, fetchImpl, {
        method: 'POST',
        body: input,
      });
      return parseFolderRow(isRecord(body) ? body['folder'] : undefined);
    },

    async patchChatFolder(id, input) {
      const token = await requireToken(getToken);
      const body = await request(
        apiUrl,
        `/api/chat-folders/${encodeURIComponent(id)}`,
        token,
        fetchImpl,
        { method: 'PATCH', body: input },
      );
      return parseFolderRow(isRecord(body) ? body['folder'] : undefined);
    },

    async reorderChatFolders(ids) {
      const token = await requireToken(getToken);
      const body = await request(apiUrl, '/api/chat-folders/order', token, fetchImpl, {
        method: 'PUT',
        body: { ids },
      });
      if (!isRecord(body) || !Array.isArray(body['folders'])) {
        throw invalidResponse();
      }
      const folders: ChatFolder[] = [];
      for (const entry of body['folders']) {
        folders.push(parseFolderRow(entry));
      }
      return folders;
    },

    async deleteChatFolder(id) {
      const token = await requireToken(getToken);
      const body = await request(
        apiUrl,
        `/api/chat-folders/${encodeURIComponent(id)}`,
        token,
        fetchImpl,
        { method: 'DELETE' },
      );
      if (!isRecord(body) || body['deleted'] !== true) {
        throw invalidResponse();
      }
    },
  };
}
