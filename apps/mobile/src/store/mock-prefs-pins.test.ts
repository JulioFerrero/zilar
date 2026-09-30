import { describe, expect, it, vi } from 'vitest';

import { createChatStore } from './chat-store';

describe('mock store chat prefs and pins (T-0135)', () => {
  it('mutes, pins and archives a chat, then unmutes and unarchives it', async () => {
    const store = createChatStore();
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.muted).toBe(false);

    await store.getState().setChatPref('ana', { mutedUntil: '2126-01-01T00:00:00.000Z' });
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.muted).toBe(true);

    await store.getState().setChatPref('ana', { pinned: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.pinnedAt).toBeInstanceOf(Date);

    await store.getState().setChatPref('ana', { archived: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.archived).toBe(true);

    // Unmute + unarchive lands back on defaults: the row is deleted.
    await store.getState().setChatPref('ana', { mutedUntil: null });
    await store.getState().setChatPref('ana', { pinned: false });
    await store.getState().setChatPref('ana', { archived: false });
    const row = store.getState().chats.find((chat) => chat.id === 'ana');
    expect(row?.muted).toBe(false);
    expect(row?.archived).toBeUndefined();
    expect(row?.pinnedAt).toBeUndefined();
  });

  it('mutes a group topics from its General row', async () => {
    const store = createChatStore();
    await store.getState().setChatPref('dev-team', { mutedUntil: '2126-01-01T00:00:00.000Z' });
    expect(store.getState().chats.find((chat) => chat.id === 't-devteam-bug')?.muted).toBe(true);
  });

  it('keeps other chats prefs and kept fields on a partial write', async () => {
    // Mute Ana, then pin Sara: Ana must stay muted (no flash back to
    // normal), and pinning the already-muted Ana must keep its mute.
    const store = createChatStore();
    await store.getState().setChatPref('ana', { mutedUntil: '2126-01-01T00:00:00.000Z' });
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.muted).toBe(true);

    await store.getState().setChatPref('sara', { pinned: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana')?.muted).toBe(true);
    expect(store.getState().chats.find((chat) => chat.id === 'sara')?.pinnedAt).toBeInstanceOf(
      Date,
    );

    await store.getState().setChatPref('ana', { pinned: true });
    const ana = store.getState().chats.find((chat) => chat.id === 'ana');
    expect(ana?.muted).toBe(true);
    expect(ana?.pinnedAt).toBeInstanceOf(Date);
  });

  it('loads the seeded pins when the chat opens', async () => {
    const store = createChatStore();
    // Before any open the cache is empty; opening loads the seeds, like
    // the real store does (the banner would otherwise stay empty).
    expect(store.getState().pins('ana')).toHaveLength(0);
    store.getState().openChat('ana');
    await Promise.resolve();
    expect(store.getState().pins('ana')).toHaveLength(1);
    expect(store.getState().pins('ana')[0]).toMatchObject({
      messageId: 'ana-11',
      kind: 'text',
    });
    store.getState().openChat('viernes');
    await Promise.resolve();
    expect(store.getState().pins('viernes')).toHaveLength(1);
    expect(store.getState().pins('viernes')[0]).toMatchObject({ kind: 'image' });
  });

  it('pins and unpins a message in mock mode', async () => {
    const store = createChatStore();
    store.getState().openChat('ana');
    await Promise.resolve();

    // The viewer may pin in a DM.
    expect(store.getState().canPin('ana')).toBe(true);
    await store.getState().pinMessage('ana', 'ana-16');
    expect(store.getState().pinFor('ana', 'ana-16')).toMatchObject({
      senderName: 'Ana',
      text: 'See you tonight ❤️',
    });

    const pin = store.getState().pinFor('ana', 'ana-16');
    expect(pin).toBeDefined();
    await store.getState().unpinMessage('ana', pin!.id);
    expect(store.getState().pinFor('ana', 'ana-16')).toBeUndefined();
  });

  it('pins a topic message in mock mode (the viewer owns the Dev team group)', async () => {
    const store = createChatStore();
    expect(store.getState().canPin('t-devteam-bug')).toBe(true);
  });

  it('adds a ticked AI in the mock new-topic sheet without throwing', async () => {
    const store = createChatStore();
    vi.useFakeTimers();
    try {
      const chatId = await store.getState().createTopic('dev-team', {
        name: 'Checkout bug',
        kind: 'bug',
        visibility: 'public',
      });
      // T-0112 should-fix: this used to throw in the mock store.
      await store.getState().addTopicAi(chatId, 'dev-ai');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins newest-first: the banner shows the latest pin', async () => {
    const store = createChatStore();
    store.getState().openChat('ana');
    await Promise.resolve();
    // The seed is the older pin; pinning a newer message puts it first,
    // like the server's newest-first list.
    await store.getState().pinMessage('ana', 'ana-16');
    const pins = store.getState().pins('ana');
    expect(pins.map((pin) => pin.messageId)).toEqual(['ana-16', 'ana-11']);
  });

  it('resets mock prefs and pins between stores', async () => {
    const first = createChatStore();
    await first.getState().setChatPref('ana', { mutedUntil: '2126-01-01T00:00:00.000Z' });
    expect(first.getState().chats.find((chat) => chat.id === 'ana')?.muted).toBe(true);

    const second = createChatStore();
    expect(second.getState().chats.find((chat) => chat.id === 'ana')?.muted).toBe(false);
    second.getState().openChat('ana');
    await Promise.resolve();
    expect(second.getState().pins('ana')).toHaveLength(1);
  });
});
