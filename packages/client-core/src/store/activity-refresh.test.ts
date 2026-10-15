import type { Payload } from '@zilar/protocol';
import type { ChatMessage } from '@zilar/xmpp-core';
import { describe, expect, it } from 'vitest';
import { isAiActivityMessage } from './activity-refresh';

const NOW = new Date('2026-10-15T12:00:00Z');
const ROOM = 'team@rooms.zilar.test';
const AI = 'dev-1@ai.zilar.test';

function message(fields: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    chatJid: ROOM,
    kind: 'groupchat',
    fromJid: AI,
    fromResolved: true,
    timestamp: NOW,
    outgoing: false,
    ...fields,
  };
}

const progressCard: Payload = {
  v: 0,
  type: 'progress',
  data: { ai: AI, stage: 'Reading files' },
};

const doneCard: Payload = {
  v: 0,
  type: 'progress',
  data: { ai: AI, stage: 'Writing the answer', state: 'done' },
};

const approvalRequest: Payload = {
  v: 0,
  type: 'approval.request',
  data: {
    id: 'a-1',
    room: ROOM,
    ai: AI,
    action: 'deploy',
    summary: 'Deploy the app',
    args_hash: 'a'.repeat(64),
    requested_by: 'ana@zilar.test',
    expires_at: '2026-10-15T12:30:00Z',
  },
};

const correction = { targetId: 'o-1' };

describe('isAiActivityMessage', () => {
  it('accepts a new progress card', () => {
    expect(isAiActivityMessage(message({ id: 'm-1', payload: progressCard }))).toBe(true);
  });

  it('accepts a progress correction that closes the card', () => {
    expect(isAiActivityMessage(message({ id: 'm-1', payload: doneCard, correction }))).toBe(true);
  });

  it('ignores a mid-turn progress correction', () => {
    expect(isAiActivityMessage(message({ id: 'm-1', payload: progressCard, correction }))).toBe(
      false,
    );
  });

  it('accepts an approval request', () => {
    expect(isAiActivityMessage(message({ id: 'm-1', payload: approvalRequest }))).toBe(true);
  });

  it('ignores a plain text message', () => {
    expect(isAiActivityMessage(message({ id: 'm-1', body: 'hello' }))).toBe(false);
  });

  it('ignores a DM progress card', () => {
    expect(
      isAiActivityMessage(message({ id: 'm-1', kind: 'chat', chatJid: AI, payload: progressCard })),
    ).toBe(false);
  });
});
