// T-1311: the peer's read mark the server reports in `/api/chats` marks my own
// messages read when history loads, a later live `displayed` still works, and
// the status ladder never moves down.
import type { ChatMessage } from '@zilar/xmpp-core';
import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { CoreState } from './ctx';
import { openHistory, type HistoryCtx } from './history';
import { handleDisplayed } from './incoming';
import { applyReadUntil } from './reads';
import { ANA, ME, NOW, testCtx } from './test-support';

/** One message of the DM with Ana: `mine` sets the sender and the direction. */
function message(id: string, mine: boolean): ChatMessage {
  return {
    kind: 'chat',
    chatJid: ANA,
    id,
    fromJid: mine ? ME : ANA,
    fromResolved: true,
    body: id,
    timestamp: NOW,
    outgoing: mine,
  };
}

/** A history context whose DM carries a peer read mark and whose server serves
 * one page. Mirrors the helper in `history.test.ts`. */
function historyWith(readUntil: string | undefined, messages: ChatMessage[]) {
  const dm = {
    id: ANA,
    kind: 'dm',
    title: 'Ana',
    unread: 0,
    ...(readUntil === undefined ? {} : { readUntil }),
  } as ChatSummary;
  const loadHistory = vi.fn(async () => ({ messages, complete: true }));
  const base = testCtx({
    core: { loadHistory },
    state: {
      status: 'online',
      historyState: {},
      historyComplete: {},
      chats: [dm],
      openChat: vi.fn(),
    } as Partial<CoreState>,
  });
  const ctx = Object.assign(base.ctx, {
    groupsJoined: true,
    pendingOpenChatId: undefined,
    cursors: {},
    loadingHistory: new Set<string>(),
    loadingOlder: new Set<string>(),
  }) as HistoryCtx;
  const statuses = (): Array<[string, string]> =>
    (ctx.get().messagesByChat[ANA] ?? []).map((item) => [item.id, item.status]);
  return { ctx, statuses };
}

describe('applyReadUntil on history load (core)', () => {
  it('marks my messages up to the peer mark read and later ones untouched', async () => {
    const { ctx, statuses } = historyWith('200', [
      message('100', true),
      message('200', true),
      message('250', false),
      message('300', true),
    ]);

    await Effect.runPromise(openHistory(ctx, ANA));

    expect(statuses()).toEqual([
      ['100', 'read'],
      ['200', 'read'],
      // The peer's own message keeps its default status.
      ['250', 'read'],
      ['300', 'sent'],
    ]);
  });

  it('a later live displayed marker still moves a message to read', () => {
    const { ctx, state } = testCtx();
    ctx.k.setChatMessage(
      ANA,
      {
        id: '400',
        chatId: ANA,
        senderId: 'u-me',
        senderName: 'You',
        text: '400',
        createdAt: NOW,
        status: 'delivered',
      },
      true,
    );

    handleDisplayed(ctx, { chatJid: ANA, fromJid: ANA, messageId: '400', outgoing: false });

    expect(state().messagesByChat[ANA]?.map((item) => item.status)).toEqual(['read']);
  });
});

describe('applyReadUntil never moves a status down (core)', () => {
  it('moves up to read and leaves a later message alone', () => {
    const { ctx, state } = testCtx();
    const add = (id: string, status: 'sent' | 'delivered' | 'read') =>
      ctx.k.setChatMessage(
        ANA,
        { id, chatId: ANA, senderId: 'u-me', senderName: 'You', text: id, createdAt: NOW, status },
        true,
      );
    add('100', 'read');
    add('200', 'delivered');
    add('300', 'sent');

    applyReadUntil(ctx, ANA, '250');

    expect(state().messagesByChat[ANA]?.map((item) => [item.id, item.status])).toEqual([
      ['100', 'read'],
      ['200', 'read'],
      ['300', 'sent'],
    ]);
  });
});
