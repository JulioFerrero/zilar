import { describe, expect, it, vi } from 'vitest';

import type { ChatFolder } from '@zilar/chat-core';

import { createChatFoldersApi, parseChatFolder, type ChatFoldersApi } from './chat-folders-api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const FOLDER: ChatFolder = {
  id: 'f-personal',
  name: 'Personal',
  icon: 'user',
  position: 0,
  includeTypes: ['dm'],
  includeChats: [],
  excludeChats: [],
  excludeMuted: false,
  excludeRead: false,
};

describe('parseChatFolder', () => {
  it('parses a valid row', () => {
    expect(parseChatFolder(FOLDER)).toEqual(FOLDER);
  });

  it('drops malformed rows and unknown icons', () => {
    expect(parseChatFolder(null)).toBeNull();
    expect(parseChatFolder({ ...FOLDER, icon: 'not-an-icon' })).toBeNull();
    expect(parseChatFolder({ ...FOLDER, includeTypes: ['dm', 'nope'] })).toBeNull();
    expect(parseChatFolder({ ...FOLDER, position: 'first' })).toBeNull();
    expect(parseChatFolder({ ...FOLDER, excludeMuted: 'no' })).toBeNull();
  });
});

describe('chat-folders api client', () => {
  it('lists folders, dropping the rows that fail the guard', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ folders: [FOLDER, { id: 'broken' }] }));
    const api: ChatFoldersApi = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    expect(await api.listChatFolders()).toEqual([FOLDER]);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/chat-folders');
  });

  it('throws unauthorized without a session', async () => {
    const api = createChatFoldersApi(async () => undefined, (async () => {
      throw new Error('must not fetch');
    }) as typeof fetch);
    await expect(api.listChatFolders()).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a response without a folders array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    await expect(api.listChatFolders()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
