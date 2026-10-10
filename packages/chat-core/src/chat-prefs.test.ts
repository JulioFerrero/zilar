import { describe, expect, it } from 'vitest';
import {
  applyChatPrefs,
  effectivePrefFor,
  isMuted,
  mutedUntilFor,
  sortPinnedFirst,
  type ChatPrefRow,
} from './chat-prefs';
import type { ChatSummary } from './types';

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

function pref(chatJid: string, overrides: Partial<ChatPrefRow> = {}): ChatPrefRow {
  return {
    chatJid,
    mutedUntil: null,
    archived: false,
    pinnedAt: null,
    ...overrides,
  };
}

describe('chatPrefs', () => {
  it('merges rows into summaries, expiring past mutes', () => {
    const now = Date.parse('2026-09-30T12:00:00.000Z');
    const chats = [chat('a@x.y'), chat('b@x.y', { muted: true })];
    const prefs = [
      pref('a@x.y', { mutedUntil: '2026-09-30T13:00:00.000Z' }),
      pref('b@x.y', { mutedUntil: '2026-09-30T11:00:00.000Z' }),
    ];
    const merged = applyChatPrefs(chats, prefs, now);
    expect(merged[0]?.muted).toBe(true);
    expect(merged[1]?.muted).toBe(false);
  });

  it('marks archived and pinned chats', () => {
    const now = Date.now();
    const merged = applyChatPrefs(
      [chat('a@x.y')],
      [pref('a@x.y', { archived: true, pinnedAt: '2026-09-30T10:00:00.000Z' })],
      now,
    );
    expect(merged[0]?.archived).toBe(true);
    expect(merged[0]?.pinnedAt).toEqual(new Date('2026-09-30T10:00:00.000Z'));
  });

  it('strips prefs when a chat has no row', () => {
    const merged = applyChatPrefs(
      [chat('a@x.y', { muted: true, archived: true, pinnedAt: new Date() })],
      [],
      Date.now(),
    );
    expect(merged[0]?.muted).toBe(false);
    expect(merged[0]?.archived).toBeUndefined();
    expect(merged[0]?.pinnedAt).toBeUndefined();
  });

  it('orders pinned chats first, newest pin first', () => {
    const ordered = sortPinnedFirst([
      chat('a', { title: 'A' }),
      chat('b', { title: 'B', pinnedAt: new Date('2026-09-30T10:00:00Z') }),
      chat('c', { title: 'C', pinnedAt: new Date('2026-09-30T11:00:00Z') }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('computes mute durations, forever far in the future', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    expect(mutedUntilFor('hour', now)).toBe('2026-09-30T13:00:00.000Z');
    expect(mutedUntilFor('day', now)).toBe('2026-10-01T12:00:00.000Z');
    const forever = mutedUntilFor('forever', now);
    expect(Date.parse(forever)).toBeGreaterThan(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(isMuted({ mutedUntil: forever }, now.getTime())).toBe(true);
    expect(isMuted({ mutedUntil: null }, now.getTime())).toBe(false);
    expect(isMuted(undefined, now.getTime())).toBe(false);
  });

  it('falls back to the group General row when a topic has no row', () => {
    const prefs = new Map([
      ['general@rooms.x', pref('general@rooms.x', { mutedUntil: '2027-01-01T00:00:00.000Z' })],
    ]);
    const now = Date.parse('2026-09-30T12:00:00.000Z');
    const fallback = effectivePrefFor(prefs, 'topic@rooms.x', 'general@rooms.x');
    expect(isMuted(fallback, now)).toBe(true);
    const own = effectivePrefFor(
      new Map([['topic@rooms.x', pref('topic@rooms.x')]]),
      'topic@rooms.x',
      'general@rooms.x',
    );
    expect(isMuted(own, now)).toBe(false);
  });

  it('inherits a group mute into topics unless the topic has its own row', () => {
    const now = Date.parse('2026-09-30T12:00:00.000Z');
    const generalRow = (overrides: Partial<ChatSummary> = {}): ChatSummary => ({
      ...chat('general@rooms.x', overrides),
      kind: 'group',
      groupId: 'g1',
      groupTitle: 'Team',
      topic: {
        id: 't-general',
        glyph: 'G',
        kind: 'chat',
        status: 'open',
        visibility: 'public',
        isGeneral: true,
        archived: false,
        owner: null,
        linkUrl: null,
        linkLabel: null,
      },
    });
    const topicRow = (id: string, overrides: Partial<ChatSummary> = {}): ChatSummary => ({
      ...chat(id, overrides),
      kind: 'group',
      groupId: 'g1',
      groupTitle: 'Team',
      topic: {
        id: `t-${id}`,
        glyph: 'B',
        kind: 'chat',
        status: 'open',
        visibility: 'public',
        isGeneral: false,
        archived: false,
        owner: null,
        linkUrl: null,
        linkLabel: null,
      },
    });
    const chats = [generalRow(), topicRow('bugs@rooms.x'), topicRow('news@rooms.x')];
    const merged = applyChatPrefs(
      chats,
      [pref('general@rooms.x', { mutedUntil: '2027-01-01T00:00:00.000Z' })],
      now,
    );
    expect(merged.find((row) => row.id === 'general@rooms.x')?.muted).toBe(true);
    expect(merged.find((row) => row.id === 'bugs@rooms.x')?.muted).toBe(true);
    // A topic with its own (unmuted) row wins over the group mute.
    const withOwn = applyChatPrefs(
      chats,
      [
        pref('general@rooms.x', { mutedUntil: '2027-01-01T00:00:00.000Z' }),
        pref('news@rooms.x', { archived: true }),
      ],
      now,
    );
    expect(withOwn.find((row) => row.id === 'news@rooms.x')?.muted).toBe(false);
    expect(withOwn.find((row) => row.id === 'news@rooms.x')?.archived).toBe(true);
    // The inherited mute never archives or pins the topic.
    expect(merged.find((row) => row.id === 'bugs@rooms.x')?.archived).toBeUndefined();
    expect(merged.find((row) => row.id === 'bugs@rooms.x')?.pinnedAt).toBeUndefined();
  });
});
