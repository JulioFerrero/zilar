import {
  FOLDER_ICONS,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';

import { API_URL } from './auth';

/**
 * The mobile twin of the web chat-folders client (`apps/web/src/lib/api.ts`,
 * T-0237): list the caller's folders. The wire contract lives in
 * `apps/server/src/chat-folders/routes.ts` (T-0232).
 *
 * Mobile has no zod, so — like `chat-prefs-api.ts` — the boundary is validated
 * with type guards. A row whose shape or icon is unknown is dropped rather
 * than failing the whole list.
 */

export interface ChatFoldersApi {
  listChatFolders(): Promise<ChatFolder[]>;
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

async function request(
  apiUrl: string,
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new ChatFoldersApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ChatFoldersApiError(response.status, code, message);
  }
  return body;
}

/** The production `ChatFoldersApi`: bearer auth, `fetch`, the build API URL. */
export function createChatFoldersApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatFoldersApi {
  return {
    async listChatFolders() {
      const token = await getToken();
      if (token === undefined) {
        throw new ChatFoldersApiError(401, 'unauthorized', 'No session');
      }
      const body = await request(apiUrl, '/api/chat-folders', token, fetchImpl);
      if (!isRecord(body) || !Array.isArray(body['folders'])) {
        throw new ChatFoldersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      const folders: ChatFolder[] = [];
      for (const entry of body['folders']) {
        const folder = parseChatFolder(entry);
        if (folder !== null) {
          folders.push(folder);
        }
      }
      return folders;
    },
  };
}
