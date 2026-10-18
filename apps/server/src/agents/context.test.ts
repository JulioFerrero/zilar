// T-2014: a room sender's label in the AI context is their database name,
// looked up by the resolved bare JID. The MUC nick is free text anyone can
// take, so it is only a label for a sender the archive could not resolve.

import type { ChatMessage } from '@zilar/xmpp-core';
import { describe, expect, it } from 'vitest';
import { buildGroupMessages, displayNameOf } from './context';

const ANA = 'ana@zilar.test';
const AI = 'ai-bot@zilar.test';

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    chatJid: 'team@muc.zilar.test',
    kind: 'groupchat',
    fromJid: ANA,
    fromResolved: true,
    timestamp: new Date('2026-10-18T10:00:00.000Z'),
    outgoing: false,
    body: 'hello',
    ...overrides,
  };
}

describe('displayNameOf', () => {
  it('uses the database name for a resolved sender, never the nick', () => {
    const name = displayNameOf(
      { fromJid: ANA, fromResolved: true, fromNick: 'Julio' },
      new Map([[ANA, 'Ana']]),
    );

    expect(name).toBe('Ana');
  });

  it('falls back to the bare JID for a resolved sender we cannot name', () => {
    expect(displayNameOf({ fromJid: ANA, fromResolved: true, fromNick: 'Julio' })).toBe(ANA);
  });

  it('uses the nick only when the sender is unresolved', () => {
    const unresolved = { fromJid: 'team@muc.zilar.test/ana', fromResolved: false, fromNick: 'Ana' };

    expect(displayNameOf(unresolved, new Map([['team@muc.zilar.test/ana', 'Ana']]))).toBe('Ana');
  });
});

describe('buildGroupMessages', () => {
  it('labels a resolved sender with their database name, not a spoofed nick', () => {
    const messages = buildGroupMessages({
      aiName: 'Helper',
      persona: 'You help.',
      senderName: 'Ana',
      today: 'Sunday, 18 October 2026, 10:00 (Europe/Madrid)',
      aiJid: AI,
      history: [message({ id: 'm-1', body: 'hi there', fromNick: 'Julio' })],
      trigger: { id: 'm-1', body: 'hi there' },
      senderNames: new Map([[ANA, 'Ana']]),
    });

    const userTurn = messages.find((entry) => entry.role === 'user');
    expect(userTurn?.content).toBe('Ana: hi there');
  });

  it('keeps the nick for an unresolved sender', () => {
    const messages = buildGroupMessages({
      aiName: 'Helper',
      persona: 'You help.',
      senderName: 'Ana',
      today: 'Sunday, 18 October 2026, 10:00 (Europe/Madrid)',
      aiJid: AI,
      history: [
        message({
          id: 'm-2',
          body: 'hi there',
          fromJid: 'team@muc.zilar.test/ana',
          fromResolved: false,
          fromNick: 'Ana',
        }),
      ],
      trigger: { id: 'm-2', body: 'hi there' },
    });

    const userTurn = messages.find((entry) => entry.role === 'user');
    expect(userTurn?.content).toBe('Ana: hi there');
  });
});
