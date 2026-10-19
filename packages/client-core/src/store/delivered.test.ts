import type { ChatMessage } from '@zilar/xmpp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDeliveredUntil,
  compareArchiveIds,
  handleDeliveredMark,
  MARK_DELIVERED_DEBOUNCE_MS,
} from './delivered';
import { handleMessage } from './incoming';
import type { CoreApi } from './ports';
import { ANA, ME, NOW, testCorePorts, testCtx } from './test-support';

afterEach(() => {
  vi.useRealTimers();
});

function message(fields: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    chatJid: ANA,
    kind: 'chat',
    fromJid: ANA,
    fromResolved: true,
    body: fields.id,
    timestamp: NOW,
    outgoing: false,
    ...fields,
  };
}

/** A core api whose delivery confirmations are recorded. */
function apiWithDelivered(calls: Array<{ jid: string; ids: string[] }>): CoreApi {
  return {
    ...testCorePorts().api,
    markChatDelivered: (jid, originIds) => {
      calls.push({ jid, ids: [...originIds] });
      return Promise.resolve();
    },
  };
}

describe('confirmDelivered (core)', () => {
  it('confirms a live message once, after the debounce', () => {
    vi.useFakeTimers();
    const calls: Array<{ jid: string; ids: string[] }> = [];
    const { ctx } = testCtx({ ports: { api: apiWithDelivered(calls) } });
    handleMessage(ctx, message({ id: 'srv-1', originId: 'o-1' }));

    vi.advanceTimersByTime(MARK_DELIVERED_DEBOUNCE_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([{ jid: ANA, ids: ['o-1'] }]);
  });

  it('sends two quick messages in one call with both ids', () => {
    vi.useFakeTimers();
    const calls: Array<{ jid: string; ids: string[] }> = [];
    const { ctx } = testCtx({ ports: { api: apiWithDelivered(calls) } });
    handleMessage(ctx, message({ id: 'srv-1', originId: 'o-1' }));
    handleMessage(ctx, message({ id: 'srv-2', originId: 'o-2' }));

    vi.advanceTimersByTime(MARK_DELIVERED_DEBOUNCE_MS);
    expect(calls).toEqual([{ jid: ANA, ids: ['o-1', 'o-2'] }]);
  });

  it('confirms nothing for an outgoing echo', () => {
    vi.useFakeTimers();
    const calls: Array<{ jid: string; ids: string[] }> = [];
    const { ctx } = testCtx({ ports: { api: apiWithDelivered(calls) } });
    handleMessage(ctx, message({ id: 'srv-1', body: 'hello', fromJid: ME, outgoing: true }));

    vi.advanceTimersByTime(MARK_DELIVERED_DEBOUNCE_MS);
    expect(calls).toEqual([]);
  });
});

describe('applyDeliveredUntil (core)', () => {
  it('moves my sent messages up to the mark to delivered, never downgrading read', () => {
    const { ctx, state } = testCtx();
    const add = (id: string, status: 'sent' | 'read') =>
      ctx.k.setChatMessage(
        ANA,
        { id, chatId: ANA, senderId: 'u-me', senderName: 'You', text: id, createdAt: NOW, status },
        true,
      );
    add('100', 'sent');
    add('200', 'read');
    add('300', 'sent');

    applyDeliveredUntil(ctx, ANA, '200');

    expect(state().messagesByChat[ANA]?.map((item) => [item.id, item.status])).toEqual([
      ['100', 'delivered'],
      ['200', 'read'],
      ['300', 'sent'],
    ]);
  });

  it("compares decimal ids by length: '999' is below '1000'", () => {
    expect(compareArchiveIds('999', '1000')).toBe(-1);
    expect(compareArchiveIds('1000', '999')).toBe(1);
    expect(compareArchiveIds('1000', '1000')).toBe(0);
  });
});

describe('handleDeliveredMark (core)', () => {
  it('moves my sent messages up to the mark and stores it on the summary', () => {
    const { ctx, state } = testCtx();
    const add = (id: string, status: 'sent' | 'read') =>
      ctx.k.setChatMessage(
        ANA,
        { id, chatId: ANA, senderId: 'u-me', senderName: 'You', text: id, createdAt: NOW, status },
        true,
      );
    add('100', 'sent');
    add('200', 'read');
    add('300', 'sent');

    handleDeliveredMark(ctx, { chatJid: ANA, until: '200' });

    expect(state().messagesByChat[ANA]?.map((item) => [item.id, item.status])).toEqual([
      ['100', 'delivered'],
      ['200', 'read'],
      ['300', 'sent'],
    ]);
    expect(state().chats.find((chat) => chat.id === ANA)?.deliveredUntil).toBe('200');
  });

  it('never moves the summary mark back', () => {
    const { ctx, state } = testCtx();

    handleDeliveredMark(ctx, { chatJid: ANA, until: '500' });
    handleDeliveredMark(ctx, { chatJid: ANA, until: '400' });

    expect(state().chats.find((chat) => chat.id === ANA)?.deliveredUntil).toBe('500');
  });
});
