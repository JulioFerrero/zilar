// Chat-folders routes (T-1045): list, create, reorder, patch and delete, the
// same bodies and mutations as web's mock (`apps/web/src/mock/api.ts:2736`).
// Validation stays light, like web's: the derived client already checks the
// payload, so the mock only guards the caps and the order list.
import {
  FOLDER_CHAT_TYPES,
  FOLDER_ICONS,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/api-contract';
import type { MockChatFolder } from './seed';
import type { MockData } from '../../state';
import {
  conflict,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';

const MAX_FOLDERS = 20;

export function handleChatFolders(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head !== 'chat-folders') {
    return undefined;
  }
  if (first === undefined && second === undefined) {
    if (request.method === 'GET') {
      return jsonResponse({ folders: data.chatFolders });
    }
    if (request.method === 'POST') {
      return createFolder(data, request);
    }
    return undefined;
  }
  if (first === 'order' && second === undefined && request.method === 'PUT') {
    return orderFolders(data, request);
  }
  if (first !== undefined && first !== 'order' && second === undefined) {
    const id = decodeURIComponent(first);
    if (request.method === 'PATCH') {
      return patchFolder(data, request, id);
    }
    if (request.method === 'DELETE') {
      return deleteFolder(data, id);
    }
  }
  return undefined;
}

function createFolder(data: MockData, request: MockHttpRequest): Response {
  if (data.chatFolders.length >= MAX_FOLDERS) {
    return conflict('folder_limit', 'Too many folders');
  }
  const body = readJsonBody(request.init);
  const folder: MockChatFolder = {
    id: `folder-mock-${data.nextFolderSequence}`,
    name: folderName(body.name),
    icon: folderIcon(body.icon),
    position: data.chatFolders.length,
    includeTypes: folderTypes(body.includeTypes),
    includeChats: chatList(body.includeChats),
    excludeChats: chatList(body.excludeChats),
    excludeMuted: body.excludeMuted === true,
    excludeRead: body.excludeRead === true,
  };
  data.nextFolderSequence += 1;
  data.chatFolders = [...data.chatFolders, folder];
  return jsonResponse({ folder }, 201);
}

function orderFolders(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const ids = Array.isArray(body.ids) ? body.ids : undefined;
  const currentIds = new Set(data.chatFolders.map((folder) => folder.id));
  if (
    ids === undefined ||
    ids.length !== data.chatFolders.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !currentIds.has(id))
  ) {
    return jsonResponse(
      {
        error: {
          code: 'invalid_request',
          message: 'Folder order must list every folder exactly once',
        },
      },
      400,
    );
  }
  const byId = new Map(data.chatFolders.map((folder) => [folder.id, folder]));
  data.chatFolders = (ids as string[]).map((id, position) => ({
    ...(byId.get(id) as MockChatFolder),
    position,
  }));
  return jsonResponse({ folders: data.chatFolders });
}

function patchFolder(data: MockData, request: MockHttpRequest, id: string): Response {
  const existing = data.chatFolders.find((folder) => folder.id === id);
  if (existing === undefined) {
    return notFound('Folder not found');
  }
  const body = readJsonBody(request.init);
  const updated: MockChatFolder = {
    ...existing,
    ...(body.name === undefined ? {} : { name: folderName(body.name) }),
    ...(body.icon === undefined ? {} : { icon: folderIcon(body.icon) }),
    ...(body.includeTypes === undefined ? {} : { includeTypes: folderTypes(body.includeTypes) }),
    ...(body.includeChats === undefined ? {} : { includeChats: chatList(body.includeChats) }),
    ...(body.excludeChats === undefined ? {} : { excludeChats: chatList(body.excludeChats) }),
    ...(body.excludeMuted === undefined ? {} : { excludeMuted: body.excludeMuted === true }),
    ...(body.excludeRead === undefined ? {} : { excludeRead: body.excludeRead === true }),
  };
  data.chatFolders = data.chatFolders.map((folder) => (folder.id === id ? updated : folder));
  return jsonResponse({ folder: updated });
}

function deleteFolder(data: MockData, id: string): Response {
  if (!data.chatFolders.some((folder) => folder.id === id)) {
    return notFound('Folder not found');
  }
  data.chatFolders = data.chatFolders
    .filter((folder) => folder.id !== id)
    .map((folder, position) => ({ ...folder, position }));
  return jsonResponse({ deleted: true });
}

function folderName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return name === '' ? 'Folder' : name;
}

function folderIcon(value: unknown): FolderIcon {
  const icons: readonly string[] = FOLDER_ICONS;
  return typeof value === 'string' && icons.includes(value) ? (value as FolderIcon) : 'folder';
}

function folderTypes(value: unknown): FolderChatType[] {
  const types: readonly string[] = FOLDER_CHAT_TYPES;
  return Array.isArray(value)
    ? value.filter(
        (item): item is FolderChatType => typeof item === 'string' && types.includes(item),
      )
    : [];
}

function chatList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
