import { describe, expect, it } from 'vitest';

import type { ChatEntry } from '@zilar/api-contract';
import { chatEntryTopics, summariesFor } from './chat-rows';

function topicWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.zilar.test',
    visibility: 'public',
    kind: 'bug',
    status: 'in_progress',
    owner: { kind: 'ai', id: 'dev-1', name: 'Dev-1' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    isGeneral: false,
    archived: false,
    memberCount: 6,
    ais: [],
    ...overrides,
  };
}

function dmEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'dm',
    chatJid: 'ana@zilar.test',
    title: 'Ana',
    userId: 'u-ana',
    ...overrides,
  } as ChatEntry;
}

function groupEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'group',
    chatJid: 'team@rooms.zilar.test',
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member',
    ...overrides,
  } as ChatEntry;
}

describe('summariesFor', () => {
  it('maps a DM to one row and marks the caller AIs', () => {
    const rows = summariesFor(dmEntry());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'ana@zilar.test', kind: 'dm', isAI: false, online: false });

    const ai = summariesFor(dmEntry({ title: 'Dev', isAi: true, avatarUrl: '/a.png' }));
    expect(ai[0]).toMatchObject({ kind: 'dm', isAI: true, avatarUrl: '/a.png' });
    expect(ai[0]?.visibility).toBeUndefined();
  });

  it('maps a group with topics to one row per topic, General keeping the group id', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [
          topicWire({
            id: 't-g',
            name: 'General',
            isGeneral: true,
            chatJid: 'team@rooms.zilar.test',
          }),
          topicWire(),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(['team@rooms.zilar.test', 't-1@rooms.zilar.test']);
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    expect(rows[1]?.topic).toMatchObject({
      id: 't-1',
      kind: 'bug',
      status: 'in_progress',
      archived: false,
    });
    expect(rows[1]?.groupTitle).toBe('Team');
  });

  it('carries visibility, handle, avatar and background onto every group row', () => {
    const rows = summariesFor(
      groupEntry({
        visibility: 'public',
        handle: '@team',
        avatarUrl: '/g.png',
        background: { backgroundPreset: 'slate', backgroundImageId: null, backgroundDim: null },
        topics: [
          topicWire({
            id: 't-g',
            name: 'General',
            isGeneral: true,
            chatJid: 'team@rooms.zilar.test',
          }),
        ],
      }),
    );
    expect(rows[0]).toMatchObject({
      visibility: 'public',
      handle: '@team',
      avatarUrl: '/g.png',
      groupBackground: { backgroundPreset: 'slate' },
    });
  });

  it('defaults visibility to private and handle to null when the server omits them', () => {
    const rows = summariesFor(groupEntry());
    expect(rows[0]).toMatchObject({ visibility: 'private', handle: null });
  });

  it('keeps one legacy row for a group without topics', () => {
    const rows = summariesFor(groupEntry());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.topic).toBeUndefined();
  });

  it('maps a channel feed row with the channel fields', () => {
    const rows = summariesFor(
      groupEntry({
        chatKind: 'channel',
        subscriberCount: 120,
        description: 'Ship notes',
        topics: [
          topicWire({
            id: 't-g',
            name: 'General',
            isGeneral: true,
            chatJid: 'team@rooms.zilar.test',
          }),
        ],
      }),
    );
    expect(rows[0]).toMatchObject({
      chatKind: 'channel',
      subscriberCount: 120,
      description: 'Ship notes',
      myRole: 'member',
    });
  });

  it('keeps a legacy channel row without topics', () => {
    const rows = summariesFor(
      groupEntry({ chatKind: 'channel', subscriberCount: 4, description: null }),
    );
    expect(rows[0]).toMatchObject({ chatKind: 'channel', subscriberCount: 4, myRole: 'member' });
  });

  it('excludes archived topics', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [
          topicWire(),
          topicWire({ id: 't-arch', chatJid: 'a@rooms.zilar.test', archived: true }),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(['t-1@rooms.zilar.test']);
  });

  it('drops a malformed topic row and keeps the valid ones', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [{ nope: true }, topicWire({ id: 't-ok', chatJid: 'ok@rooms.zilar.test' })],
      }),
    );
    expect(rows.map((row) => row.topic?.id ?? row.id)).toEqual(['t-ok']);
  });
});

describe('chatEntryTopics', () => {
  it('validates each row and drops the malformed ones', () => {
    expect(
      chatEntryTopics({ topics: [{ nope: true }, topicWire()] }).map((topic) => topic.id),
    ).toEqual(['t-1']);
    expect(chatEntryTopics({})).toEqual([]);
    expect(chatEntryTopics({ topics: 'nope' as unknown as unknown[] })).toEqual([]);
  });
});
