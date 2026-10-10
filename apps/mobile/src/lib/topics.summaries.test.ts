import { describe, expect, it } from 'vitest';

import type { ChatEntry } from './chat-api';
import type { Topic } from './topics-api';
import { summariesFor } from '../store/real-store';

// Guards for mobile's entry-to-row mapper (T-0924). They pass before the move
// and after `topics.ts` binds to the shared core `summariesFor`, so they pin
// the behaviour the move must not lose. The new fields the core adds to group
// rows (visibility, handle, avatarUrl, groupBackground) are covered by the
// core test, not asserted here.

function topicWire(overrides: Partial<Topic> = {}): Topic {
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
    roles: [],
    approverRole: null,
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
    chatJid: 'general@rooms.zilar.test',
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    ...overrides,
  } as ChatEntry;
}

describe('summariesFor (mobile guard)', () => {
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
        topics: [
          topicWire({
            id: 't-g',
            name: 'General',
            isGeneral: true,
            chatJid: 'general@rooms.zilar.test',
          }),
          topicWire(),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(['general@rooms.zilar.test', 't-1@rooms.zilar.test']);
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    expect(rows[1]?.title).toBe('Checkout bug');
  });

  it('keeps one legacy row for a group without topics', () => {
    const rows = summariesFor(groupEntry({ chatJid: 'team@rooms.zilar.test' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'team@rooms.zilar.test', kind: 'group' });
    expect(rows[0]?.topic).toBeUndefined();
  });

  it('maps a channel feed row with the channel fields', () => {
    const rows = summariesFor(
      groupEntry({
        chatJid: 'acme@rooms.zilar.test',
        chatKind: 'channel',
        subscriberCount: 4,
        description: 'Release notes.',
        topics: [
          topicWire({
            id: 't-feed',
            name: 'General',
            isGeneral: true,
            chatJid: 'acme@rooms.zilar.test',
          }),
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chatKind: 'channel',
      subscriberCount: 4,
      description: 'Release notes.',
      myRole: 'member',
    });
  });

  it('excludes archived topics', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [
          topicWire({ archived: true }),
          topicWire({ id: 't-ok', chatJid: 'ok@rooms.zilar.test' }),
        ],
      }),
    );
    expect(rows.map((row) => row.topic?.id ?? row.id)).toEqual(['t-ok']);
  });

  it('skips a malformed topic row the lenient parser drops today', () => {
    const entry = {
      ...groupEntry(),
      topics: [{ nope: true }, topicWire({ id: 't-ok', chatJid: 'ok@rooms.zilar.test' })],
    } as unknown as ChatEntry;

    const rows = summariesFor(entry);

    expect(rows.map((row) => row.topic?.id ?? row.id)).toEqual(['t-ok']);
  });
});
