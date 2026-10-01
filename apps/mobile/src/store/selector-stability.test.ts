import { describe, expect, it } from 'vitest';

import { createChatStore } from './chat-store';
import { createRealChatStore } from './real-store';

// A selector that returns a fresh array or object on every call makes React
// re-render forever ("Maximum update depth exceeded"): opening any chat
// crashed on a device because `pins(chatId)` returned a new `[]`.
describe('store selectors keep a stable reference while nothing changed', () => {
  it('real store: pins of a chat without pins', () => {
    const store = createRealChatStore();
    expect(store.getState().pins('nobody@rooms.galena.test')).toBe(
      store.getState().pins('nobody@rooms.galena.test'),
    );
  });

  it('real store: messages of a chat without messages', () => {
    const store = createRealChatStore();
    expect(store.getState().messages('nobody@rooms.galena.test')).toBe(
      store.getState().messages('nobody@rooms.galena.test'),
    );
  });

  it('mock store: messages of an unknown chat and the group detail', () => {
    const store = createChatStore();
    expect(store.getState().messages('nobody@rooms.galena.test')).toBe(
      store.getState().messages('nobody@rooms.galena.test'),
    );
    expect(store.getState().groupDetail('g-devteam')).toBe(
      store.getState().groupDetail('g-devteam'),
    );
  });

  it('mock store: pins of a chat without pins', () => {
    const store = createChatStore();
    expect(store.getState().pins('nobody@rooms.galena.test')).toBe(
      store.getState().pins('nobody@rooms.galena.test'),
    );
  });

  it('mock store: group detail follows the group id, not only the revision', () => {
    const store = createChatStore();
    const acme = store.getState().groupDetail('g-acme');
    const studio = store.getState().groupDetail('g-studio');
    expect(studio).not.toBe(acme);
    expect(studio?.id).toBe('g-studio');
    expect(store.getState().groupDetail('g-acme')?.id).toBe('g-acme');
    expect(store.getState().groupDetail('g-studio')).toBe(studio);
  });

  it('mock store: group roles and topic roles until a write bumps them', async () => {
    const store = createChatStore();
    store.getState().start();
    const state = store.getState();
    const first = state.groupRoles('g-devteam');
    expect(first).toBeDefined();
    expect(store.getState().groupRoles('g-devteam')).toBe(first);

    const topicChat = store.getState().chats.find((chat) => chat.topic !== undefined);
    if (topicChat !== undefined) {
      const roles = store.getState().topicRoles(topicChat.id);
      expect(store.getState().topicRoles(topicChat.id)).toBe(roles);
    }

    await store.getState().createGroupRole('g-devteam', 'QA');
    expect(store.getState().groupRoles('g-devteam')).not.toBe(first);
  });
});
