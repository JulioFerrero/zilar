import { describe, expect, it } from 'vitest';
import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { createChatStore, folderUnread, visibleChats } from './store';

function folder(
  id: string,
  name: string,
  includeTypes: ChatFolder['includeTypes'],
  position = 0,
): ChatFolder {
  return {
    id,
    name,
    icon: 'folder',
    position,
    includeTypes,
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
  };
}

function dm(id: string, unread: number, muted = false): ChatSummary {
  return {
    id,
    title: id,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread,
    muted,
    memberCount: 2,
  };
}

function ai(id: string, unread: number): ChatSummary {
  return {
    id,
    title: id,
    kind: 'ai',
    isAI: true,
    space: 'personal',
    unread,
    muted: false,
    memberCount: 1,
  };
}

const PERSONAL = folder('f-personal', 'Personal', ['dm'], 0);
const AIS = folder('f-ais', 'AIs', ['ai'], 1);

describe('chat folders store', () => {
  it('setFolders sorts by position and resets a vanished active id to all', () => {
    const store = createChatStore();
    store.getState().setFolders([AIS, PERSONAL]);
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['f-personal', 'f-ais']);

    store.getState().setActiveFolder('f-personal');
    store.getState().setFolders([AIS]);
    expect(store.getState().activeFolder).toBe('all');
    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['f-ais']);
  });

  it('keeps the active id when it is still in the list', () => {
    const store = createChatStore();
    store.getState().setFolders([PERSONAL, AIS]);
    store.getState().setActiveFolder('f-ais');
    store.getState().setFolders([AIS, PERSONAL]);
    expect(store.getState().activeFolder).toBe('f-ais');
  });

  it('filters visibleChats by the active folder', () => {
    const store = createChatStore({
      chats: [dm('c-dm', 1), ai('c-ai', 2)],
    });
    store.getState().setFolders([PERSONAL, AIS]);

    store.getState().setActiveFolder('f-personal');
    expect(visibleChats(store.getState()).map((chat) => chat.id)).toEqual(['c-dm']);

    store.getState().setActiveFolder('f-ais');
    expect(visibleChats(store.getState()).map((chat) => chat.id)).toEqual(['c-ai']);
  });

  it('folderUnread skips muted chats', () => {
    const store = createChatStore({
      chats: [dm('c-dm', 3), dm('c-muted', 5, true)],
    });
    expect(folderUnread(store.getState(), 'all')).toBe(3);
  });
});
