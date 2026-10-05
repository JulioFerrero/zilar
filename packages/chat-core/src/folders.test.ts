import { describe, expect, it } from 'vitest';
import type { ChatSummary } from './types';
import {
  FOLDER_ICONS,
  chatFolderType,
  defaultFolders,
  folderMatches,
  folderUnreadTotal,
  sortFolders,
  type ChatFolder,
} from './folders';

function chat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    title: overrides.id,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function folder(overrides: Partial<ChatFolder> = {}): ChatFolder {
  return {
    id: 'f1',
    name: 'Test',
    icon: 'folder',
    position: 0,
    includeTypes: ['dm'],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
    ...overrides,
  };
}

describe('chatFolderType', () => {
  it('maps ai flag and kind to ai', () => {
    expect(chatFolderType(chat({ id: 'a', kind: 'ai' }))).toBe('ai');
    expect(chatFolderType(chat({ id: 'b', kind: 'group', isAI: true }))).toBe('ai');
  });
  it('maps dm kind to dm', () => {
    expect(chatFolderType(chat({ id: 'a', kind: 'dm' }))).toBe('dm');
  });
  it('maps group with channel chatKind to channel', () => {
    expect(chatFolderType(chat({ id: 'a', kind: 'group', chatKind: 'channel' }))).toBe('channel');
  });
  it('maps group without chatKind to group', () => {
    expect(chatFolderType(chat({ id: 'a', kind: 'group' }))).toBe('group');
    expect(chatFolderType(chat({ id: 'b', kind: 'group', chatKind: 'group' }))).toBe('group');
  });
});

describe('folderMatches', () => {
  it('includes by type', () => {
    expect(folderMatches(folder(), chat({ id: 'a', kind: 'dm' }))).toBe(true);
    expect(folderMatches(folder(), chat({ id: 'b', kind: 'group' }))).toBe(false);
  });
  it('includes by id', () => {
    const f = folder({ includeTypes: [], includeChats: ['x'] });
    expect(folderMatches(f, chat({ id: 'x', kind: 'group' }))).toBe(true);
    expect(folderMatches(f, chat({ id: 'y', kind: 'group' }))).toBe(false);
  });
  it('exclude by id beats include', () => {
    const f = folder({ includeChats: ['x'], excludeChats: ['x'] });
    expect(folderMatches(f, chat({ id: 'x', kind: 'dm' }))).toBe(false);
    const g = folder({ includeTypes: ['dm'], excludeChats: ['x'] });
    expect(folderMatches(g, chat({ id: 'x', kind: 'dm' }))).toBe(false);
  });
  it('excludes muted when flagged', () => {
    expect(folderMatches(folder({ excludeMuted: true }), chat({ id: 'a', muted: true }))).toBe(
      false,
    );
    expect(folderMatches(folder(), chat({ id: 'a', muted: true }))).toBe(true);
  });
  it('excludes read when flagged', () => {
    expect(folderMatches(folder({ excludeRead: true }), chat({ id: 'a', unread: 0 }))).toBe(false);
    expect(folderMatches(folder({ excludeRead: true }), chat({ id: 'a', unread: 2 }))).toBe(true);
  });
  it('archived never matches', () => {
    expect(folderMatches(folder({ includeChats: ['x'] }), chat({ id: 'x', archived: true }))).toBe(
      false,
    );
  });
});

describe('folderUnreadTotal', () => {
  const chats = [
    chat({ id: 'a', kind: 'dm', unread: 3 }),
    chat({ id: 'b', kind: 'dm', unread: 5, muted: true }),
    chat({ id: 'c', kind: 'dm', unread: 7, archived: true }),
    chat({ id: 'd', kind: 'group', unread: 4 }),
  ];
  it('skips muted and archived', () => {
    expect(folderUnreadTotal(folder(), chats)).toBe(3);
  });
  it('all total counts every non-archived non-muted chat', () => {
    expect(folderUnreadTotal('all', chats)).toBe(7);
  });
});

describe('sortFolders', () => {
  it('sorts by position, ties by id, returns a new array', () => {
    const a = folder({ id: 'b', position: 1 });
    const b = folder({ id: 'a', position: 1 });
    const c = folder({ id: 'c', position: 0 });
    const input = [a, b, c];
    const sorted = sortFolders(input);
    expect(sorted.map((f) => f.id)).toEqual(['c', 'a', 'b']);
    expect(sorted).not.toBe(input);
  });
});

describe('defaultFolders', () => {
  it('returns Personal and AIs defaults', () => {
    const defaults = defaultFolders();
    expect(defaults).toHaveLength(2);
    expect(defaults[0]).toMatchObject({
      id: 'default-personal',
      name: 'Personal',
      icon: 'user',
      position: 0,
      includeTypes: ['dm'],
    });
    expect(defaults[1]).toMatchObject({
      id: 'default-ais',
      name: 'AIs',
      icon: 'bot',
      position: 1,
      includeTypes: ['ai'],
    });
  });
});

describe('FOLDER_ICONS', () => {
  it('has 24 unique names', () => {
    expect(FOLDER_ICONS).toHaveLength(24);
    expect(new Set(FOLDER_ICONS).size).toBe(24);
  });
});
