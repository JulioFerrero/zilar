import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { READ_DELAY_MS, SENT_DELAY_MS, createChatStore } from './chat-store';

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

  it('ships the ten mock chats with their history', () => {
    const store = createChatStore();
    expect(store.getState().chats).toHaveLength(10);
    expect(store.getState().messages('ana').length).toBeGreaterThan(10);
    expect(store.getState().messages('dev-ai').at(-1)?.text).toBe('Tests pass. Merge?');
  });
});
