import type { UiMessage } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import type { CoreState } from './ctx';
import type { HistoryCtx, HistoryState } from './history';
import { KEEP_INACTIVE, pruneInactiveChats } from './prune';
import { ANA, TEAM, testCtx } from './test-ctx';

/** `count` messages from Ana, `ana-<from>` the oldest, one minute apart. */
function history(count: number, from = 0, status: UiMessage['status'] = 'sent'): UiMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `ana-${from + index}`,
    chatId: ANA,
    senderId: ANA,
    senderName: 'Ana',
    text: `msg ${from + index}`,
    createdAt: new Date(Date.UTC(2026, 8, 28, 6, from + index)),
    status,
  }));
}

/** A history context whose only loaded messages are the ones passed. */
function pruneCtx(
  messagesByChat: Record<string, UiMessage[]>,
  activeChatId: string,
): { ctx: HistoryCtx; state: () => HistoryState; shown: (chatId: string) => string[] } {
  const base = testCtx({
    state: {
      messagesByChat,
      activeChatId,
      historyState: {},
      historyComplete: {},
      status: 'online',
      openChat: () => {},
    } as unknown as Partial<CoreState>,
  });
  const ctx = Object.assign(base.ctx, {
    groupsJoined: true,
    pendingOpenChatId: undefined,
    cursors: {},
    loadingHistory: new Set<string>(),
    loadingOlder: new Set<string>(),
  }) as HistoryCtx;
  return {
    ctx,
    state: () => ctx.get(),
    shown: (chatId) => (ctx.get().messagesByChat[chatId] ?? []).map((message) => message.id),
  };
}

describe('pruneInactiveChats (core)', () => {
  it('keeps the newest KEEP_INACTIVE of an inactive chat and leaves the active one', () => {
    const older = history(350);
    const { ctx, state, shown } = pruneCtx({ [ANA]: older, [TEAM]: older }, ANA);

    pruneInactiveChats(ctx, ANA);

    // The open chat is untouched.
    expect(shown(ANA)).toHaveLength(350);
    expect(state().historyComplete[ANA]).toBeUndefined();
    // The other chat keeps only its newest 300 and pages the archive again.
    expect(shown(TEAM)).toEqual(older.slice(-KEEP_INACTIVE).map((message) => message.id));
    expect(state().historyComplete[TEAM]).toBe(false);
  });

  it('does not prune a chat with a send in flight', () => {
    const sending = [...history(349), ...history(1, 349, 'sending')];
    const { ctx, shown } = pruneCtx({ [TEAM]: sending }, ANA);

    pruneInactiveChats(ctx, ANA);

    expect(shown(TEAM)).toHaveLength(350);
  });
});
