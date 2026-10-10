import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ChatEntry } from './chats';

const decode = Schema.decodeUnknownSync(ChatEntry);

describe('ChatEntry', () => {
  it('decodes a DM entry and marks the caller AIs', () => {
    const dm = decode({ kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' });
    expect(dm).toEqual({ kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' });

    const ai = decode({
      kind: 'dm',
      chatJid: 'dev@zilar.test',
      title: 'Dev',
      userId: 'ai-1',
      isAi: true,
    });
    expect(ai.kind === 'dm' && ai.isAi).toBe(true);
  });

  it('decodes a group entry with its channel, visibility, picture and background', () => {
    const entry = decode({
      kind: 'group',
      chatJid: 'team@rooms.zilar.test',
      title: 'Team',
      groupId: 'g1',
      memberCount: 3,
      role: 'admin',
      chatKind: 'channel',
      subscriberCount: 3,
      description: 'Ship notes',
      visibility: 'public',
      handle: '@team',
      avatarUrl: '/group.png',
      background: { backgroundPreset: 'slate', backgroundImageId: null, backgroundDim: null },
      topics: [{ id: 't-1' }],
    });
    expect(entry).toMatchObject({
      kind: 'group',
      handle: '@team',
      visibility: 'public',
      role: 'admin',
    });
    if (entry.kind === 'group') {
      expect(entry.topics).toHaveLength(1);
      expect(entry.background?.backgroundPreset).toBe('slate');
    }
  });

  it('keeps a legacy group without topics parseable', () => {
    const entry = decode({
      kind: 'group',
      chatJid: 'team@rooms.zilar.test',
      title: 'Team',
      groupId: 'g1',
      memberCount: 3,
      role: 'owner',
    });
    expect(entry).toMatchObject({ kind: 'group', role: 'owner' });
    if (entry.kind === 'group') {
      expect(entry.topics).toBeUndefined();
    }
  });

  it('rejects an entry that is neither a dm nor a group', () => {
    expect(() => decode({ kind: 'dm' })).toThrow();
    expect(() =>
      decode({
        kind: 'group',
        chatJid: 'team@rooms.zilar.test',
        title: 'Team',
        groupId: 'g1',
        memberCount: 'many',
        role: 'member',
      }),
    ).toThrow();
    expect(() =>
      decode({
        kind: 'group',
        chatJid: 'team@rooms.zilar.test',
        title: 'Team',
        groupId: 'g1',
        memberCount: 3,
        role: 'root',
      }),
    ).toThrow();
  });
});
