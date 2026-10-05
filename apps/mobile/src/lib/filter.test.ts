import { describe, expect, it } from 'vitest';

import type { ChatFolder, ChatSummary } from '@zilar/chat-core';

import { filterChats, unreadCount } from './filter';

function chat(id: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title: id,
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
    id: 'f-personal',
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

const ANA = chat('Ana', { kind: 'dm', unread: 2 });
const DEV_AI = chat('Dev AI', { isAI: true, kind: 'ai', unread: 1 });
const DEV_TEAM = chat('Dev team', { kind: 'group', unread: 3 });
const VIERNES = chat('Viernes', { kind: 'group', unread: 0 });
const CHATS: ChatSummary[] = [ANA, DEV_AI, DEV_TEAM, VIERNES];

describe('filterChats', () => {
  it('returns every chat for All (undefined)', () => {
    expect(filterChats(CHATS, { folder: undefined, search: '' }).map((item) => item.id)).toEqual([
      'Ana',
      'Dev AI',
      'Dev team',
      'Viernes',
    ]);
  });

  it('matches a folder through the shared chat-core matcher', () => {
    const dm = folder({ includeTypes: ['dm'] });
    const ai = folder({ id: 'f-ais', name: 'AIs', includeTypes: ['ai'] });
    expect(filterChats(CHATS, { folder: dm, search: '' }).map((item) => item.id)).toEqual(['Ana']);
    expect(filterChats(CHATS, { folder: ai, search: '' }).map((item) => item.id)).toEqual([
      'Dev AI',
    ]);
  });

  it('honours includeChats, excludeChats and archived chats', () => {
    const onlyTeam = folder({ includeTypes: [], includeChats: ['Dev team'] });
    const withoutAna = folder({ includeTypes: ['dm'], excludeChats: ['Ana'] });
    const archived = chat('Gone', { kind: 'dm', archived: true });
    expect(filterChats(CHATS, { folder: onlyTeam, search: '' }).map((item) => item.id)).toEqual([
      'Dev team',
    ]);
    expect(filterChats(CHATS, { folder: withoutAna, search: '' })).toEqual([]);
    expect(
      filterChats([...CHATS, archived], { folder: folder(), search: '' }).map((item) => item.id),
    ).toEqual(['Ana']);
  });

  it('filters by title, ignoring case and surrounding spaces', () => {
    expect(
      filterChats(CHATS, { folder: undefined, search: '  dev ' }).map((item) => item.id),
    ).toEqual(['Dev AI', 'Dev team']);
    expect(filterChats(CHATS, { folder: undefined, search: 'nothing' })).toEqual([]);
  });

  it('combines folder and search', () => {
    const ai = folder({ id: 'f-ais', name: 'AIs', includeTypes: ['ai'] });
    expect(filterChats(CHATS, { folder: ai, search: 'dev' }).map((item) => item.id)).toEqual([
      'Dev AI',
    ]);
  });
});

describe('unreadCount', () => {
  it('sums All and per-folder unread, skipping muted chats', () => {
    expect(unreadCount(CHATS, undefined)).toBe(6);
    expect(unreadCount(CHATS, folder({ includeTypes: ['dm'] }))).toBe(2);
    const muted = [...CHATS, chat('Muted group', { kind: 'group', unread: 9, muted: true })];
    expect(unreadCount(muted, undefined)).toBe(6);
    expect(unreadCount(muted, folder({ includeTypes: ['dm', 'group', 'ai'] }))).toBe(6);
  });
});
