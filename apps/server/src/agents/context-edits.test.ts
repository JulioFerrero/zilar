import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { applyEdits } from './context';

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage {
  return {
    chatJid: 'room@zilar.localhost',
    kind: 'groupchat',
    fromJid: 'julio@zilar.localhost',
    fromResolved: true,
    timestamp: new Date('2026-10-01T10:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

describe('applyEdits', () => {
  it('drops a retracted message, matching the origin id in a DM and the stanza-id in a group', () => {
    const dm: ChatMessage[] = [
      message({ id: 's-1', originId: 'o-1', body: 'the secret', kind: 'chat' }),
      message({
        id: 's-2',
        body: '',
        kind: 'chat',
        retraction: { targetId: 'o-1' },
      }),
    ];
    const group: ChatMessage[] = [
      message({ id: 's-1', originId: 'o-1', body: 'the secret' }),
      message({ id: 's-2', body: '', retraction: { targetId: 's-1' } }),
    ];

    expect(applyEdits(dm).map((item) => item.id)).toEqual([]);
    expect(applyEdits(group).map((item) => item.id)).toEqual([]);
  });
});
