import { groupMessages, unreadDividerIndex } from '@zilar/chat-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOCK_DRAFT_FINAL_MESSAGE_ID,
  MOCK_DRAFT_FINAL_TEXT,
  MOCK_DRAFT_STREAM_TEXT,
  MOCK_DRAFT_TURN_ID,
} from '../mock/drafts';
import { MOCK_LOAD_DELAY_MS } from '../mock/load';
import {
  READ_DELAY_MS,
  SENT_DELAY_MS,
  TYPING_DURATION_MS,
  TYPING_START_MS,
  createChatStore,
  isMockMode,
  type MockEnv,
} from './chat-store';

describe('chat store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends an outgoing message as sending, then sent, then read', () => {
    const store = createChatStore();
    store.getState().sendText('ana', '  Hello there  ');

    const sending = store.getState().messages('ana').at(-1);
    expect(sending?.text).toBe('Hello there');
    expect(sending?.status).toBe('sending');
    expect(sending?.senderId).toBe('me');
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.lastMessage?.id).toBe(
      sending?.id,
    );

    vi.advanceTimersByTime(SENT_DELAY_MS);
    expect(store.getState().messages('ana').at(-1)?.status).toBe('sent');

    vi.advanceTimersByTime(READ_DELAY_MS - SENT_DELAY_MS);
    expect(store.getState().messages('ana').at(-1)?.status).toBe('read');
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.lastMessage?.status).toBe(
      'read',
    );
  });

  it('ignores empty text and unknown chats', () => {
    const store = createChatStore();
    const before = store.getState().messages('ana').length;
    store.getState().sendText('ana', '   ');
    store.getState().sendText('nope', 'hi');
    expect(store.getState().messages('ana')).toHaveLength(before);
  });

  it('keeps the reply reference on the sent message', () => {
    const store = createChatStore();
    const replyTo = { id: 'ana-16', senderName: 'Ana', text: 'See you tonight ❤️' };
    store.getState().sendText('ana', 'On my way', { replyTo });

    expect(store.getState().messages('ana').at(-1)?.replyTo).toEqual(replyTo);
  });

  it('sends a demo sticker optimistically with the payload on the card', () => {
    const store = createChatStore();
    const choice = {
      stickerId: '21111111-1111-4111-8111-111111111111',
      packId: '11111111-1111-4111-8111-111111111111',
      url: '/api/stickers/21111111-1111-4111-8111-111111111111/file',
      emoji: '🐱',
      width: 200,
      height: 200,
      mime: 'image/png' as const,
    };
    store.getState().sendSticker('ana', choice);

    const sent = store.getState().messages('ana').at(-1);
    expect(sent?.text).toBe('🐱');
    expect(sent?.card).toEqual({ v: 0, type: 'sticker', data: expect.objectContaining({}) });
    expect(sent?.status).toBe('sending');

    vi.advanceTimersByTime(SENT_DELAY_MS);
    expect(store.getState().messages('ana').at(-1)?.status).toBe('sent');
  });

  it('refuses a hostile sticker choice with a visible error and no bubble', () => {
    const store = createChatStore();
    const before = store.getState().messages('ana').length;
    store.getState().sendSticker('ana', {
      stickerId: 's1',
      packId: 'p1',
      url: 'https://evil.test/x.webp',
      width: 9999,
      height: 200,
      mime: 'image/png' as const,
    });

    expect(store.getState().messages('ana')).toHaveLength(before);
    expect(store.getState().actionError).toEqual({
      chatId: 'ana',
      message: 'That sticker could not be sent.',
    });
  });

  it('clears a stale error banner on a later validated send', () => {
    const store = createChatStore();
    store.getState().sendSticker('ana', {
      stickerId: 's1',
      packId: 'p1',
      url: 'https://evil.test/x.webp',
      width: 9999,
      height: 200,
      mime: 'image/png' as const,
    });
    expect(store.getState().actionError).toBeDefined();

    store.getState().sendSticker('ana', {
      stickerId: '21111111-1111-4111-8111-111111111111',
      packId: '11111111-1111-4111-8111-111111111111',
      url: '/api/stickers/21111111-1111-4111-8111-111111111111/file',
      emoji: '🐱',
      width: 200,
      height: 200,
      mime: 'image/png' as const,
    });
    expect(store.getState().actionError).toBeUndefined();
  });

  it('clears unread when a chat is opened', () => {
    const store = createChatStore();
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.unread).toBe(2);

    store.getState().openChat('ana');

    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.unread).toBe(0);
    expect(store.getState().activeChatId).toBe('ana');
    expect(store.getState().chats.find((chat) => chat.id === 'sara')?.unread).toBe(0);
  });

  it('keeps search and folder state', () => {
    const store = createChatStore();
    store.getState().setSearch('dev');
    store.getState().setActiveFolder('work');
    expect(store.getState().search).toBe('dev');
    expect(store.getState().activeFolder).toBe('work');
  });

  it('shows typing after the mock delay and clears it again', () => {
    const store = createChatStore();
    expect(store.getState().typing).toEqual({});

    vi.advanceTimersByTime(TYPING_START_MS);
    expect(store.getState().typing).toEqual({
      ana: { names: ['Ana'] },
      viernes: { names: ['Luis'] },
    });

    vi.advanceTimersByTime(TYPING_DURATION_MS);
    expect(store.getState().typing).toEqual({});
  });

  it('places the unread divider above the first unread message', () => {
    const store = createChatStore();
    const items = groupMessages(store.getState().messages('ana'));
    const index = unreadDividerIndex(items, 2);

    expect(index).not.toBeNull();
    const firstUnread = items[index ?? -1];
    expect(firstUnread?.kind).toBe('message');
    expect(firstUnread?.kind === 'message' ? firstUnread.message.id : undefined).toBe('ana-15');
  });

  it('ships nine mock chats with the Dev team group replaced by its seven topics, plus two channels', () => {
    const store = createChatStore();
    expect(store.getState().chats).toHaveLength(18);
    expect(store.getState().messages('ana').length).toBeGreaterThan(10);
    expect(store.getState().messages('dev-ai').at(-1)?.text).toBe('Tests pass. Merge?');
  });

  it('seeds the stream phase with an active dev-ai draft', () => {
    const store = createChatStore('stream');
    expect(store.getState().drafts['dev-ai']).toEqual({
      turnId: MOCK_DRAFT_TURN_ID,
      text: MOCK_DRAFT_STREAM_TEXT,
    });
    expect(store.getState().finishedDraftMessages).toEqual({});
  });

  it('seeds the final phase with the completed reply where the draft was', () => {
    const store = createChatStore('final');
    const last = store.getState().messages('dev-ai').at(-1);
    expect(last?.id).toBe(MOCK_DRAFT_FINAL_MESSAGE_ID);
    expect(last?.text).toBe(MOCK_DRAFT_FINAL_TEXT);
    expect(store.getState().drafts).toEqual({});
    expect(store.getState().finishedDraftMessages[MOCK_DRAFT_FINAL_MESSAGE_ID]).toBe(
      MOCK_DRAFT_TURN_ID,
    );
    expect(store.getState().chats.find((chat) => chat.id === 'dev-ai')?.lastMessage?.id).toBe(
      MOCK_DRAFT_FINAL_MESSAGE_ID,
    );
  });

  it('is loaded at once by default', () => {
    const store = createChatStore();
    expect(store.getState().chatsLoad).toBe('loaded');
    expect(store.getState().historyLoad['ana']).toBe('loaded');
  });

  it('slow starts empty and loading, then settles', () => {
    const store = createChatStore(undefined, 'slow');
    expect(store.getState().chatsLoad).toBe('loading');
    expect(store.getState().chats).toHaveLength(0);

    vi.advanceTimersByTime(MOCK_LOAD_DELAY_MS);

    expect(store.getState().chatsLoad).toBe('loaded');
    expect(store.getState().chats).toHaveLength(18);
    expect(store.getState().historyLoad['ana']).toBe('loaded');
  });

  it('error keeps its chats but reports the failures', () => {
    const store = createChatStore(undefined, 'error');
    expect(store.getState().chatsLoad).toBe('error');
    expect(store.getState().chats).toHaveLength(18);
    expect(store.getState().historyLoad['ana']).toBe('error');
  });

  it('empty has no chats at all', () => {
    const store = createChatStore(undefined, 'empty');
    expect(store.getState().chatsLoad).toBe('loaded');
    expect(store.getState().chats).toHaveLength(0);
    expect(store.getState().messages('ana')).toHaveLength(0);
  });

  it('no-messages has chats but no history', () => {
    const store = createChatStore(undefined, 'no-messages');
    expect(store.getState().chats).toHaveLength(10);
    expect(store.getState().messages('ana')).toHaveLength(0);
    expect(store.getState().historyLoad['ana']).toBe('loaded');
  });

  it('the mock retry actions settle the states for screenshots', () => {
    const store = createChatStore(undefined, 'error');
    store.getState().reloadChats();
    store.getState().retryHistory('ana');
    expect(store.getState().chatsLoad).toBe('loaded');
    expect(store.getState().historyLoad['ana']).toBe('loaded');
  });

  it('openAtMessage opens the chat and lands on the loaded message', async () => {
    const store = createChatStore();

    const found = await store.getState().openAtMessage('ana', 'ana-12');

    expect(found.id).toBe('ana-12');
    expect(store.getState().activeChatId).toBe('ana');
    expect(store.getState().jumpTarget).toEqual({ chatId: 'ana', messageId: 'ana-12' });

    store.getState().clearJumpTarget();
    expect(store.getState().jumpTarget).toBeUndefined();
  });

  it('openAtMessage rejects message_not_found for an unknown message', async () => {
    const store = createChatStore();

    await expect(store.getState().openAtMessage('ana', 'ana-99')).rejects.toThrow(
      'message_not_found',
    );
    expect(store.getState().jumpTarget).toBeUndefined();
  });
});

describe('isMockMode', () => {
  const env = (overrides: Partial<MockEnv> = {}): MockEnv => ({
    dev: false,
    envMock: undefined,
    nodeEnv: 'production',
    ...overrides,
  });

  it('ignores ?mock=1 when the gate is closed', () => {
    expect(isMockMode({ mock: '1' }, env())).toBe(false);
  });

  it('honors ?mock=1 in a dev build or with EXPO_PUBLIC_ZILAR_MOCK set', () => {
    expect(isMockMode({ mock: '1' }, env({ dev: true }))).toBe(true);
    expect(isMockMode({ mock: '1' }, env({ envMock: 'default' }))).toBe(true);
  });

  it('never enables mock mode with EXPO_PUBLIC_ZILAR_MOCK=false or 0', () => {
    expect(isMockMode({ mock: '1' }, env({ envMock: 'false' }))).toBe(false);
    expect(isMockMode({ mock: '1' }, env({ envMock: '0' }))).toBe(false);
  });

  it('keeps the test and EXPO_PUBLIC_ZILAR_MOCK=1 modes always on', () => {
    expect(isMockMode({}, env({ nodeEnv: 'test' }))).toBe(true);
    expect(isMockMode({}, env({ envMock: '1' }))).toBe(true);
  });
});
