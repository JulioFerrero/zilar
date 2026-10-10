import { describe, expect, it } from 'vitest';

import type { ChatSummary } from '@zilar/chat-core';

import { archivedChats, optimisticPrefRow, unarchivedChats } from './chat-prefs';
import type { ChatPref } from './chat-prefs-api';

const FUTURE = new Date('2026-10-01T12:00:00Z').toISOString();

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

function pref(chatJid: string, overrides: Partial<ChatPref> = {}): ChatPref {
  return {
    chatJid,
    mutedUntil: null,
    archived: false,
    pinnedAt: null,
    updatedAt: new Date('2026-09-30T11:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('optimisticPrefRow', () => {
  const saved: ChatPref[] = [
    pref('ana', { mutedUntil: FUTURE, pinnedAt: '2026-09-30T10:00:00.000Z' }),
  ];
  const rowNow = new Date('2026-09-30T12:00:00Z');

  it('keeps the saved fields a partial input does not touch', () => {
    const row = optimisticPrefRow('ana', saved, { pinned: true }, rowNow);
    expect(row.mutedUntil).toBe(FUTURE);
    expect(row.pinnedAt).toBe(rowNow.toISOString());
    expect(row.archived).toBe(false);
  });

  it('writes defaults back for cleared fields and starts blank for new chats', () => {
    const cleared = optimisticPrefRow('ana', saved, { mutedUntil: null, pinned: false }, rowNow);
    expect(cleared.mutedUntil).toBe(FUTURE);
    expect(cleared.pinnedAt).toBeNull();
    expect(cleared.archived).toBe(false);
    const fresh = optimisticPrefRow('sara', saved, { archived: true }, rowNow);
    expect(fresh).toMatchObject({ chatJid: 'sara', mutedUntil: null, archived: true });
    expect(fresh.pinnedAt).toBeNull();
  });
});

describe('archived split', () => {
  it('splits archived from the main list', () => {
    const rows = [chat('a'), chat('b', { archived: true }), chat('c', { archived: true })];
    expect(archivedChats(rows).map((row) => row.id)).toEqual(['b', 'c']);
    expect(unarchivedChats(rows).map((row) => row.id)).toEqual(['a']);
  });
});
