import { describe, expect, it } from 'vitest';

import type { ChatEntry } from '@/lib/api';
import { summariesFor } from './chatRows';

// Guards for the entry-to-row mapper (T-0924). They pass before the move and
// after the web binds to the shared core `summariesFor`, so they pin the
// behaviour the move must not lose.

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

function topic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-g',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: 'team@rooms.zilar.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
    archived: false,
    memberCount: 6,
    ais: [],
    ...overrides,
  };
}

describe('summariesFor (web guard)', () => {
  it('maps a DM entry to one row, marking an AI DM', () => {
    const rows = summariesFor(dmEntry());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'ana@zilar.test', kind: 'dm', isAI: false });

    const ai = summariesFor(dmEntry({ title: 'Dev', isAi: true, avatarUrl: '/a.png' }));
    expect(ai[0]).toMatchObject({ kind: 'dm', isAI: true, avatarUrl: '/a.png' });
  });

  it('maps a group with topics to one row per topic, General keeping the group id', () => {
    const rows = summariesFor(
      groupEntry({
        visibility: 'public',
        handle: '@team',
        avatarUrl: '/g.png',
        background: { backgroundPreset: 'slate', backgroundImageId: null, backgroundDim: null },
        topics: [
          topic(),
          topic({
            id: 't-bug',
            name: 'Checkout bug',
            isGeneral: false,
            chatJid: 'bug-topic@rooms.zilar.test',
          }),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual([
      'team@rooms.zilar.test',
      'bug-topic@rooms.zilar.test',
    ]);
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    expect(rows[0]).toMatchObject({
      visibility: 'public',
      handle: '@team',
      avatarUrl: '/g.png',
      groupBackground: { backgroundPreset: 'slate' },
    });
  });

  it('keeps one legacy row for a group without topics', () => {
    const rows = summariesFor(groupEntry());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'team@rooms.zilar.test',
      visibility: 'private',
      handle: null,
    });
    expect(rows[0]?.topic).toBeUndefined();
  });

  it('maps a channel feed row with the channel fields', () => {
    const rows = summariesFor(
      groupEntry({
        chatKind: 'channel',
        subscriberCount: 120,
        description: 'Ship notes',
        topics: [topic()],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chatKind: 'channel',
      subscriberCount: 120,
      description: 'Ship notes',
      myRole: 'member',
    });
  });

  it('excludes archived topics', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [
          topic(),
          topic({ id: 't-archive', chatJid: 'arch@rooms.zilar.test', archived: true }),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(['team@rooms.zilar.test']);
  });
});
