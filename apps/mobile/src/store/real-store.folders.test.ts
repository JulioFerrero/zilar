import type { ChatFolder } from '@zilar/chat-core';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatFoldersApiError,
  type ChatFoldersApi,
  type CreateChatFolderInput,
  type PatchChatFolderInput,
} from '../lib/chat-folders-api';

import { createRealChatStore } from './real-store';

function folder(overrides: Partial<ChatFolder> = {}): ChatFolder {
  return {
    id: 'f-1',
    name: 'Personal',
    icon: 'user',
    position: 0,
    includeTypes: ['dm'],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
    ...overrides,
  };
}

function fakeFolders(initial: ChatFolder[] = []): ChatFoldersApi {
  let list = [...initial];
  let sequence = 1;
  return {
    listChatFolders: vi.fn(async (): Promise<ChatFolder[]> => [...list]),
    createChatFolder: vi.fn(async (input: CreateChatFolderInput): Promise<ChatFolder> => {
      const created = folder({
        id: `f-${sequence}`,
        name: input.name,
        icon: input.icon,
        position: list.length,
        includeTypes: input.includeTypes ?? [],
        includeChats: input.includeChats ?? [],
        excludeChats: input.excludeChats ?? [],
        excludeMuted: input.excludeMuted ?? false,
        excludeRead: input.excludeRead ?? false,
      });
      sequence += 1;
      list = [...list, created];
      return created;
    }),
    patchChatFolder: vi.fn(async (id: string, input: PatchChatFolderInput): Promise<ChatFolder> => {
      const existing = list.find((entry) => entry.id === id);
      if (existing === undefined) {
        throw new ChatFoldersApiError(404, 'not_found', 'No such folder');
      }
      const updated: ChatFolder = {
        ...existing,
        name: input.name ?? existing.name,
        icon: input.icon ?? existing.icon,
        includeTypes: input.includeTypes ?? existing.includeTypes,
        includeChats: input.includeChats ?? existing.includeChats,
        excludeChats: input.excludeChats ?? existing.excludeChats,
        excludeMuted: input.excludeMuted ?? existing.excludeMuted,
        excludeRead: input.excludeRead ?? existing.excludeRead,
      };
      list = list.map((entry) => (entry.id === id ? updated : entry));
      return updated;
    }),
    reorderChatFolders: vi.fn(async (ids: string[]): Promise<ChatFolder[]> => {
      const byId = new Map(list.map((entry) => [entry.id, entry]));
      list = ids.map((id, position) => ({ ...(byId.get(id) ?? folder({ id })), position }));
      return [...list];
    }),
    deleteChatFolder: vi.fn(async (id: string): Promise<void> => {
      list = list.filter((entry) => entry.id !== id);
    }),
  };
}

describe('real store folders (T-0255)', () => {
  it('creates a folder and merges the returned row', async () => {
    const api = fakeFolders();
    const store = createRealChatStore({ chatFoldersApi: api });

    const created = await store.getState().createFolder({
      name: 'Work',
      icon: 'briefcase',
      includeTypes: ['group'],
    });

    expect(api.createChatFolder).toHaveBeenCalledWith({
      name: 'Work',
      icon: 'briefcase',
      includeTypes: ['group'],
    });
    expect(created.id).toBe('f-1');
    expect(store.getState().folders).toEqual([created]);
  });

  it('patches a folder and replaces it in the list', async () => {
    const api = fakeFolders([folder()]);
    const store = createRealChatStore({ chatFoldersApi: api });
    store.getState().setFolders([folder()]);

    const updated = await store.getState().updateFolder('f-1', { name: 'Friends', icon: 'heart' });

    expect(api.patchChatFolder).toHaveBeenCalledWith('f-1', { name: 'Friends', icon: 'heart' });
    expect(updated.name).toBe('Friends');
    expect(store.getState().folders).toEqual([updated]);
  });

  it('reorders from the server list', async () => {
    const api = fakeFolders([
      folder({ id: 'a', name: 'A', position: 0 }),
      folder({ id: 'b', name: 'B', position: 1 }),
    ]);
    const store = createRealChatStore({ chatFoldersApi: api });
    store
      .getState()
      .setFolders([
        folder({ id: 'a', name: 'A', position: 0 }),
        folder({ id: 'b', name: 'B', position: 1 }),
      ]);

    await store.getState().reorderFolders(['b', 'a']);

    expect(api.reorderChatFolders).toHaveBeenCalledWith(['b', 'a']);
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('deletes a folder by id', async () => {
    const api = fakeFolders([folder()]);
    const store = createRealChatStore({ chatFoldersApi: api });
    store.getState().setFolders([folder()]);

    await store.getState().deleteFolder('f-1');

    expect(api.deleteChatFolder).toHaveBeenCalledWith('f-1');
    expect(store.getState().folders).toEqual([]);
  });

  it('rejects with the server message when the API fails', async () => {
    const api = fakeFolders();
    vi.mocked(api.createChatFolder).mockRejectedValue(
      new ChatFoldersApiError(400, 'folder_limit', 'Too many folders'),
    );
    const store = createRealChatStore({ chatFoldersApi: api });

    await expect(
      store.getState().createFolder({ name: 'Work', icon: 'briefcase' }),
    ).rejects.toThrow('Too many folders');
  });

  it('starts unloaded and flips foldersLoaded on the first setFolders', () => {
    const store = createRealChatStore({ chatFoldersApi: fakeFolders([folder()]) });
    expect(store.getState().foldersLoaded).toBe(false);

    store.getState().setFolders([folder()]);

    expect(store.getState().foldersLoaded).toBe(true);
    expect(store.getState().folders).toEqual([folder()]);
  });
});
