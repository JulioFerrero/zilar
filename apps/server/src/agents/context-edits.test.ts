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
  it('keeps a corrected message once with the new text, and drops a target whose correction has no body', () => {
    const editedHistory: ChatMessage[] = [
      message({ id: 's-1', originId: 'o-1', body: 'the secret is hunter2' }),
      message({ id: 's-2', originId: 'o-2', body: 'unrelated' }),
      message({
        id: 's-3',
        originId: 'o-3',
        body: 'the secret is redacted',
        correction: { targetId: 'o-1' },
      }),
    ];
    const bodilessCorrection: ChatMessage[] = [
      message({ id: 's-1', originId: 'o-1', body: 'the secret is hunter2' }),
      message({ id: 's-2', originId: 'o-2', body: 'unrelated' }),
      message({ id: 's-3', originId: 'o-3', correction: { targetId: 'o-1' } }),
    ];

    const edited = applyEdits(editedHistory);
    expect(edited.map((item) => item.id)).toEqual(['s-1', 's-2']);
    expect(edited[0]?.body).toBe('the secret is redacted');
    expect(applyEdits(bodilessCorrection).map((item) => item.id)).toEqual(['s-2']);
  });

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

  it('drops the AI progress messages', () => {
    const history: ChatMessage[] = [
      message({
        id: 's-1',
        body: 'working on it',
        payload: { v: 0, type: 'progress', data: { ai: 'ai@zilar.localhost', stage: 'working' } },
      }),
      message({ id: 's-2', body: 'here is the answer' }),
    ];

    expect(applyEdits(history).map((item) => item.id)).toEqual(['s-2']);
  });
});
