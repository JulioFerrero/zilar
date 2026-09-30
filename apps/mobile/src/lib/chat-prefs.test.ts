import { describe, expect, it } from 'vitest';

import type { ChatSummary } from '@galena/chat-core';

import {
  applyChatPrefs,
  archivedChats,
  isChatMuted,
  mutedUntilFor,
  optimisticPrefRow,
  sortChatPinnedFirst,
  unarchivedChats,
} from './chat-prefs';
import type { ChatPref } from './chat-prefs-api';

const NOW = new Date('2026-09-30T12:00:00Z').getTime();
const FUTURE = new Date('2026-10-01T12:00:00Z').toISOString();
const EXPIRED = new Date('2026-09-01T12:00:00Z').toISOString();

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

function topicChat(id: string, groupId: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return chat(id, {
    kind: 'group',
    groupId,
    groupTitle: 'Dev team',
    topic: {
      id: `topic-${id}`,
      glyph: 'T',
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  });
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

describe('mute durations', () => {
  it('stamps the duration after now, forever far in the future', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(mutedUntilFor('hour', now)).toBe('2026-09-30T13:00:00.000Z');
    expect(mutedUntilFor('week', now)).toBe('2026-10-07T12:00:00.000Z');
    expect(new Date(mutedUntilFor('forever', now)).getFullYear()).toBeGreaterThan(2100);
  });

  it('reads muted only while the stamp is in the future', () => {
    expect(isChatMuted(pref('a', { mutedUntil: FUTURE }), NOW)).toBe(true);
    expect(isChatMuted(pref('a', { mutedUntil: EXPIRED }), NOW)).toBe(false);
    expect(isChatMuted(pref('a'), NOW)).toBe(false);
    expect(isChatMuted(undefined, NOW)).toBe(false);
  });
});

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

describe('applyChatPrefs', () => {
  it('merges mute, archive and pin into the rows', () => {
    const rows = applyChatPrefs(
      [chat('ana', { unread: 2 }), chat('sara')],
      [
        pref('ana', { mutedUntil: FUTURE }),
        pref('sara', { archived: true, pinnedAt: '2026-09-30T10:00:00.000Z' }),
      ],
      NOW,
    );
    expect(rows[0]?.muted).toBe(true);
    expect(rows[0]?.unread).toBe(2);
    expect(rows[1]?.archived).toBe(true);
    expect(rows[1]?.pinnedAt).toEqual(new Date('2026-09-30T10:00:00.000Z'));
  });

  it('reads an expired mute as unmuted and drops prefs with no row', () => {
    const rows = applyChatPrefs([chat('ana')], [pref('ana', { mutedUntil: EXPIRED })], NOW);
    expect(rows[0]?.muted).toBe(false);
    const withoutRow = applyChatPrefs([chat('ana', { muted: true })], [], NOW);
    expect(withoutRow[0]?.muted).toBe(false);
  });

  it('mutes a group topics from the General row unless a topic has its own', () => {
    const general = topicChat('general@g', 'g1', {
      topic: { ...topicChat('x', 'g1').topic!, isGeneral: true, id: 't-g' },
    });
    const bug = topicChat('bug@g', 'g1');
    const rows = applyChatPrefs([general, bug], [pref('general@g', { mutedUntil: FUTURE })], NOW);
    expect(rows[0]?.muted).toBe(true);
    expect(rows[1]?.muted).toBe(true);
    // The inherited mute never archives or pins the topic.
    expect(rows[1]?.archived).toBeUndefined();
    expect(rows[1]?.pinnedAt).toBeUndefined();

    // A topic with its own row wins over the group row.
    const own = applyChatPrefs(
      [general, bug],
      [pref('general@g', { mutedUntil: FUTURE }), pref('bug@g')],
      NOW,
    );
    expect(own[1]?.muted).toBe(false);
  });
});

describe('ordering and archived', () => {
  it('sorts pinned first, newer pins first', () => {
    const rows = sortChatPinnedFirst([
      chat('b', { pinnedAt: new Date('2026-09-30T09:00:00Z') }),
      chat('c'),
      chat('a', { pinnedAt: new Date('2026-09-30T10:00:00Z') }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    // No pins: the order is untouched.
    const plain = [chat('b'), chat('a')];
    expect(sortChatPinnedFirst(plain).map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('splits archived from the main list', () => {
    const rows = [chat('a'), chat('b', { archived: true }), chat('c', { archived: true })];
    expect(archivedChats(rows).map((row) => row.id)).toEqual(['b', 'c']);
    expect(unarchivedChats(rows).map((row) => row.id)).toEqual(['a']);
  });
});
