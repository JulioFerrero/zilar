// T-2028: the draft-stream contract shared by web and phone (W1-h). The frames
// on the AI message pipeline: one valid event of each type, the three rejection
// cases the task names, and the reconnect delay's bounds and growth.
import { describe, expect, it } from 'vitest';

import { decodeDraftEvent, draftReconnectDelay } from './draft-events';

const TURN_ID = '8d8b7e2a-6c1f-4d3e-9a2b-5f6c7d8e9f01';
const CHAT_JID = 'ai-ana@zilar.test';

const DRAFT = { type: 'draft', chatJid: CHAT_JID, turnId: TURN_ID, text: 'Hello' };
const END = { type: 'end', chatJid: CHAT_JID, turnId: TURN_ID, outcome: 'sent' };

describe('decodeDraftEvent', () => {
  it('decodes a valid draft event', () => {
    expect(decodeDraftEvent('draft', JSON.stringify(DRAFT))).toEqual(DRAFT);
  });

  it('decodes a valid end event', () => {
    expect(decodeDraftEvent('end', JSON.stringify(END))).toEqual(END);
    expect(decodeDraftEvent('end', JSON.stringify({ ...END, outcome: 'failed' }))).toEqual({
      ...END,
      outcome: 'failed',
    });
  });

  it('drops a bad UUID', () => {
    const badTurn = { ...DRAFT, turnId: 'not-a-uuid' };
    expect(decodeDraftEvent('draft', JSON.stringify(badTurn))).toBeUndefined();
  });

  it('drops a missing field', () => {
    const withoutText = { type: DRAFT.type, chatJid: CHAT_JID, turnId: TURN_ID };
    expect(decodeDraftEvent('draft', JSON.stringify(withoutText))).toBeUndefined();
  });

  it('drops bad JSON and an event of the other type', () => {
    expect(decodeDraftEvent('draft', '{not json')).toBeUndefined();
    expect(decodeDraftEvent('draft', JSON.stringify(END))).toBeUndefined();
  });
});

describe('draftReconnectDelay', () => {
  const BASE = 1_000;
  const MAX = 30_000;

  it('stays within [base, max] at every attempt', () => {
    for (let attempt = 0; attempt <= 20; attempt += 1) {
      expect(draftReconnectDelay(attempt, () => 0)).toBeGreaterThanOrEqual(BASE);
      expect(draftReconnectDelay(attempt, () => 1)).toBeLessThanOrEqual(MAX);
    }
  });

  it('grows with the attempt until the cap', () => {
    const delays = [0, 1, 2, 3, 4].map((attempt) => draftReconnectDelay(attempt, () => 0.5));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
    expect(draftReconnectDelay(10, () => 1)).toBe(MAX);
  });
});
