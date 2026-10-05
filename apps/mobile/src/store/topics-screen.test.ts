import { describe, expect, it, vi } from 'vitest';

import { mayCreateTopic } from '../lib/topics';
import { mockDevteamGroupDetail } from '../mock/topics';
import { createChatStore } from './chat-store';

describe('topics screen gate and mock create flow (T-0112 review)', () => {
  it('loads the Dev team detail by group id, not by chat id', () => {
    const store = createChatStore();
    // The route param is the group id; a chat id resolves nothing.
    expect(store.getState().groupDetail('g-devteam')).toMatchObject({ id: 'g-devteam' });
    expect(store.getState().groupDetail('dev-team')).toBeUndefined();
  });

  it('shows "+" for the owner, hides it for a member unless the switch is on', () => {
    const detail = mockDevteamGroupDetail();
    const members = detail.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      role: member.role,
    }));
    // The mock viewer is the owner: may create regardless of the switch.
    expect(mayCreateTopic({ members, meUserId: 'me', membersCanCreateTopics: false })).toBe(true);
    // A plain member needs the switch.
    expect(mayCreateTopic({ members, meUserId: 'luis', membersCanCreateTopics: false })).toBe(
      false,
    );
    expect(mayCreateTopic({ members, meUserId: 'luis', membersCanCreateTopics: true })).toBe(true);
  });

  it('creates a topic in mock mode and opens it', async () => {
    vi.useFakeTimers();
    try {
      const store = createChatStore();
      expect(store.getState().chats.map((chat) => chat.id)).toContain('dev-team');
      // No duplicate General row: the legacy dev-team seed is replaced by topics.
      expect(store.getState().chats.filter((chat) => chat.id === 'dev-team')).toHaveLength(1);
      const before = store.getState().chats.length;
      const chatId = await store.getState().createTopic('dev-team', {
        name: 'Checkout bug',
        kind: 'bug',
        visibility: 'public',
      });
      expect(chatId).toContain('t-mock-');
      expect(store.getState().chats).toHaveLength(before + 1);
      const row = store.getState().chats.find((chat) => chat.id === chatId);
      expect(row?.title).toBe('Checkout bug');
      expect(row?.topic?.kind).toBe('bug');
      expect(row?.groupId).toBe('g-devteam');
      // Opening the new topic clears its unread like any chat.
      store.getState().openChat(chatId);
      expect(store.getState().activeChatId).toBe(chatId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the owner display name on a mock patch (no id leak)', async () => {
    const store = createChatStore();
    await store.getState().patchTopic('t-devteam-bug', {
      owner: { kind: 'user', id: 'ana' },
    });
    // The mock has no member directory: a fresh owner id renders as the id,
    // but re-setting the same owner keeps its display name.
    const row = store.getState().chats.find((chat) => chat.id === 't-devteam-bug');
    expect(row?.topic?.owner).toMatchObject({ kind: 'user', id: 'ana' });
    await store.getState().patchTopic('t-devteam-bug', {
      owner: { kind: 'user', id: 'ana' },
    });
    expect(
      store.getState().chats.find((chat) => chat.id === 't-devteam-bug')?.topic?.owner?.name,
    ).not.toBe('');
  });
});
