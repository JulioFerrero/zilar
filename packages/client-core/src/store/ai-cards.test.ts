// T-2001: a person can put an AI card payload in a message, but the ledger
// must not hand it to a renderer as a card. Only an `ai-` sender keeps it; a
// body-less refused card shows the fixed unsupported sentence.

import type { Payload } from '@zilar/protocol';
import { describe, expect, it } from 'vitest';
import { approvalSentBy, isAiOnlyCardType, senderAiId, UNSUPPORTED_MESSAGE_TEXT } from './ai-cards';
import type { LedgerStanza } from './ledger-types';
import { ANA, ME, testCtx } from './test-ctx';

const AI = 'ai-dev@zilar.test/desk';

const question: Payload = {
  v: 0,
  type: 'question',
  data: {
    id: 'q-1',
    ai: 'ai-dev@zilar.test',
    question: 'Ship the fix?',
    options: ['Yes', 'No'],
  },
};

function stanza(fromJid: string, payload: Payload, body?: string): LedgerStanza {
  return {
    id: 'm-1',
    chatJid: ANA,
    fromJid,
    fromResolved: true,
    timestamp: new Date('2026-10-18T12:00:00Z'),
    outgoing: false,
    payload,
    ...(body === undefined ? {} : { body }),
  };
}

describe('ai cards', () => {
  it('drops a question card from a person and keeps the body text', () => {
    const { ctx } = testCtx();

    const ui = ctx.k.toUiMessage(stanza(ANA, question, 'not a card'), ME);

    expect(ui.card).toBeUndefined();
    expect(ui.text).toBe('not a card');
  });

  it('shows the unsupported sentence for a body-less card from a person', () => {
    const { ctx } = testCtx();

    const ui = ctx.k.toUiMessage(stanza(ANA, question), ME);

    expect(ui.card).toBeUndefined();
    expect(ui.text).toBe(UNSUPPORTED_MESSAGE_TEXT);
  });

  it('keeps a question card from an AI sender', () => {
    const { ctx } = testCtx();

    const ui = ctx.k.toUiMessage(stanza(AI, question), ME);

    expect(ui.card).toEqual(question);
    expect(ui.text).toBeUndefined();
  });

  it('knows the AI-only card types and the sender AI id', () => {
    expect(isAiOnlyCardType('approval.request')).toBe(true);
    expect(isAiOnlyCardType('progress')).toBe(true);
    expect(isAiOnlyCardType('sticker')).toBe(false);
    expect(senderAiId(AI)).toBe('dev');
    expect(senderAiId(ANA)).toBeUndefined();
  });

  it('matches the server approval record to the sender AI id', () => {
    expect(approvalSentBy('dev', AI)).toBe(true);
    expect(approvalSentBy('ai-dev', AI)).toBe(true);
    expect(approvalSentBy('other', AI)).toBe(false);
    expect(approvalSentBy('dev', ANA)).toBe(false);
  });
});
