// The shared server-unread merge rule and the debounced read mark
// (T-1207, the message pipeline): a newer server row replaces `unread` and
// `lastMessage`, an older one keeps memory, and `recordRead` sends a numeric
// mark once after the debounce but never a local id.
import type { ChatSummary } from '@zilar/chat-core';
import { describe, expect, it, vi } from 'vitest';
import { clearActiveChatRead } from './polling';
import { recordRead } from './reads';
import { testCtx, ANA } from './test-ctx';
import { mergeUnread } from './chat-rows';

const CHAT = 'ana@zilar.test';

function row(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: CHAT,
    kind: 'dm',
    title: 'Ana',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  } as ChatSummary;
}

function preview(id: string, at: string, text = 'hello') {
  return {
    id,
    chatId: CHAT,
    senderId: 'Ana',
    senderName: 'Ana',
    text,
    createdAt: new Date(at),
    status: 'sent' as const,
  };
}

describe('mergeUnread', () => {
  it('a server row newer than memory replaces unread and lastMessage', () => {
    const memory = row({ unread: 5, lastMessage: preview('old', '2026-10-01T10:00:00Z') });
    const fresh = row({ unread: 0, lastMessage: preview('new', '2026-10-02T10:00:00Z') });

    const merged = mergeUnread(fresh, memory, undefined);

    expect(merged.unread).toBe(0);
    expect(merged.lastMessage?.id).toBe('new');
  });

  it('an older server row keeps memory', () => {
    const memory = row({ unread: 2, lastMessage: preview('new', '2026-10-02T10:00:00Z') });
    const fresh = row({ unread: 9, lastMessage: preview('old', '2026-10-01T10:00:00Z') });

    const merged = mergeUnread(fresh, memory, undefined);

    expect(merged.unread).toBe(2);
    expect(merged.lastMessage?.id).toBe('new');
  });

  it('the open chat always ends at 0', () => {
    const memory = row({ unread: 0 });
    const fresh = row({ unread: 4, lastMessage: preview('new', '2026-10-02T10:00:00Z') });

    expect(mergeUnread(fresh, memory, CHAT).unread).toBe(0);
  });

  it('a DM entry maps the server unread, preview and delivered mark (T-1361)', async () => {
    const { summariesFor } = await import('./chat-rows');
    const rows = summariesFor({
      kind: 'dm',
      chatJid: CHAT,
      title: 'Ana',
      unread: 1,
      lastMessage: {
        id: 'o-12',
        text: 'push test 12',
        senderName: 'Ana',
        at: '2026-10-14T12:30:25Z',
        archiveId: '1791981025538427',
      },
      deliveredUntil: '1791981025538427',
    });
    expect(rows[0]?.unread).toBe(1);
    expect(rows[0]?.lastMessage?.id).toBe('o-12');
    expect(rows[0]?.deliveredUntil).toBe('1791981025538427');
  });

  it('a chat-rows entry maps the server unread and preview onto the row', async () => {
    const { summariesFor } = await import('./chat-rows');
    const rows = summariesFor({
      kind: 'dm',
      chatJid: CHAT,
      title: 'Ana',
      unread: 3,
      lastMessage: { id: 'o-9', text: 'hey', senderName: 'Ana', at: '2026-10-02T10:00:00Z' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unread).toBe(3);
    expect(rows[0]?.lastMessage?.text).toBe('hey');
    expect(rows[0]?.lastMessage?.senderName).toBe('Ana');
  });
});

describe('recordRead (server mark)', () => {
  it('calls markChatRead once after the debounce for a numeric id, never for a local id', () => {
    vi.useFakeTimers();
    try {
      const markChatRead = vi.fn(async () => undefined);
      const { ctx, state } = testCtx({
        ports: {
          api: {
            getMe: async () => ({ id: 'u', name: 'Me' }),
            getChats: async () => [],
            getContacts: async () => [],
            getXmppToken: async () => ({ jid: ANA, token: 't', service: 's', domain: 'd' }),
            markChatRead,
          },
        },
        state: { chats: [row({ unread: 3 })] },
      });

      recordRead(ctx, CHAT, '1760000000000000');
      recordRead(ctx, CHAT, '1760000000000001');
      expect(markChatRead).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(markChatRead).toHaveBeenCalledTimes(1);
      expect(markChatRead).toHaveBeenCalledWith(CHAT, '1760000000000001');
      expect(state().chats[0]?.unread).toBe(0);
      expect(ctx.lastRead[CHAT]).toBe('1760000000000001');

      recordRead(ctx, CHAT, 'local-3');
      vi.advanceTimersByTime(1000);
      expect(markChatRead).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clearActiveChatRead marks read with the archive id and displays the origin id', async () => {
    const { summariesFor } = await import('./chat-rows');
    const rows = summariesFor({
      kind: 'dm',
      chatJid: CHAT,
      title: 'Ana',
      unread: 2,
      lastMessage: {
        id: 'o-9',
        text: 'hey',
        senderName: 'Ana',
        at: '2026-10-02T10:00:00Z',
        archiveId: '1759322400000000',
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastMessage?.id).toBe('o-9');
    expect(rows[0]?.lastMessage?.archiveId).toBe('1759322400000000');

    vi.useFakeTimers();
    try {
      const markChatRead = vi.fn(async () => undefined);
      const markDisplayed = vi.fn();
      const { ctx } = testCtx({
        core: { markDisplayed },
        ports: {
          api: {
            getMe: async () => ({ id: 'u', name: 'Me' }),
            getChats: async () => [],
            getContacts: async () => [],
            getXmppToken: async () => ({ jid: ANA, token: 't', service: 's', domain: 'd' }),
            markChatRead,
          },
        },
        state: { activeChatId: CHAT, chats: rows },
      });

      clearActiveChatRead(ctx);

      expect(markDisplayed).toHaveBeenCalledTimes(1);
      expect(markDisplayed).toHaveBeenCalledWith(CHAT, 'chat', 'o-9');
      expect(markChatRead).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(markChatRead).toHaveBeenCalledTimes(1);
      expect(markChatRead).toHaveBeenCalledWith(CHAT, '1759322400000000');
    } finally {
      vi.useRealTimers();
    }
  });
});
