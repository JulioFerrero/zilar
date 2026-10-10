import { describe, expect, it, vi } from 'vitest';

import type { ChatFolder } from '@zilar/chat-core';

import { createChatFoldersApi, parseChatFolder, type ChatFoldersApi } from './chat-folders-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

function callOf(fetchImpl: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
}

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
    const [url, init] = callOf(fetchImpl);
    expect(url).toContain('/api/chat-folders');
    expect(init.method).toBe('GET');
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

  it('creates a folder with POST and the JSON body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ folder: FOLDER }, 201));
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    const input = { name: 'Personal', icon: 'user' as const, includeTypes: ['dm' as const] };
    expect(await api.createChatFolder(input)).toEqual(FOLDER);
    const [url, init] = callOf(fetchImpl);
    expect(url).toContain('/api/chat-folders');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('patches a folder with PATCH and an encoded id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ folder: FOLDER }));
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    expect(await api.patchChatFolder('f 1', { name: 'Renamed' })).toEqual(FOLDER);
    const [url, init] = callOf(fetchImpl);
    expect(url).toContain('/api/chat-folders/f%201');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Renamed' });
  });

  it('reorders folders with PUT /order and returns the list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ folders: [FOLDER] }));
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    expect(await api.reorderChatFolders(['a', 'b'])).toEqual([FOLDER]);
    const [url, init] = callOf(fetchImpl);
    expect(url).toContain('/api/chat-folders/order');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['a', 'b'] });
  });

  it('deletes a folder with DELETE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ deleted: true }));
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    await api.deleteChatFolder('f-1');
    const [url, init] = callOf(fetchImpl);
    expect(url).toContain('/api/chat-folders/f-1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('rejects a malformed write response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ folder: { id: 'broken' } }));
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    await expect(api.createChatFolder({ name: 'x', icon: 'user' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps a server error to ChatFoldersApiError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'folder_limit', message: 'Too many folders' } }, 400),
    );
    const api = createChatFoldersApi(async () => 'tok', fetchImpl as typeof fetch);
    await expect(api.createChatFolder({ name: 'x', icon: 'user' })).rejects.toMatchObject({
      status: 400,
      code: 'folder_limit',
      message: 'Too many folders',
    });
  });
});
