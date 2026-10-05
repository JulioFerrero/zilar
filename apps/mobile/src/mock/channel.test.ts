import { describe, expect, it } from 'vitest';

import { mockChannelChats, mockChannelDetail, mockChangeChannelRole } from './channel';
import { createChatStore } from '../store/chat-store';

describe('mock channels (T-0144)', () => {
  it('seeds a subscriber channel and an admin channel', () => {
    const chats = mockChannelChats();
    expect(chats.map((chat) => chat.title)).toEqual(['Acme Announcements', 'Studio Updates']);
    const subscriber = chats.find((chat) => chat.id === 'c-acme');
    expect(subscriber).toMatchObject({
      chatKind: 'channel',
      subscriberCount: 4,
      description: 'Release notes and team news.',
      myRole: 'member',
      groupId: 'g-acme',
    });
    expect(subscriber?.topic?.isGeneral).toBe(true);
    const owned = chats.find((chat) => chat.id === 'c-studio');
    expect(owned).toMatchObject({ chatKind: 'channel', myRole: 'owner' });
  });

  it('shows the demo channels in the mock store list', () => {
    const store = createChatStore();
    const ids = store.getState().chats.map((chat) => chat.id);
    expect(ids).toContain('c-acme');
    expect(ids).toContain('c-studio');
  });

  it('reads the admins slice for a subscriber channel', async () => {
    const store = createChatStore();
    const members = await store.getState().listChannelMembers('g-acme');
    // The viewer subscribes in Acme: only who posts, never the audience.
    expect(members.map((member) => member.userId).sort()).toEqual(['u-ana', 'u-rita']);
  });

  it('reads the full audience for an owned channel', async () => {
    const store = createChatStore();
    const members = await store.getState().listChannelMembers('g-studio');
    expect(members.map((member) => member.userId).sort()).toEqual(['me', 'u-luis']);
  });

  it('promotes and demotes in memory, with the last-admin guard', async () => {
    const store = createChatStore();
    // The viewer owns Studio Updates: promoting Luis works.
    await store.getState().changeChannelRole('c-studio', 'u-luis', 'admin');
    expect(
      mockChannelDetail('g-studio')?.members.find((member) => member.userId === 'u-luis')?.role,
    ).toBe('admin');
    // The feed row flips its role, so the composer bar follows.
    expect(store.getState().chats.find((chat) => chat.id === 'c-studio')?.myRole).toBe('owner');

    // Demoting the last admin rejects with 409 `channel_needs_admin`.
    await store.getState().changeChannelRole('c-studio', 'u-luis', 'member');
    await expect(
      store.getState().changeChannelRole('c-studio', 'me', 'member'),
    ).rejects.toMatchObject({ status: 409, code: 'channel_needs_admin' });
  });

  it('rejects a role write in a channel the viewer does not own', async () => {
    const store = createChatStore();
    // The viewer only subscribes in Acme: same-404, like the server.
    await expect(
      store.getState().changeChannelRole('c-acme', 'u-luis', 'admin'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('leaves a channel by removing its feed row', async () => {
    const store = createChatStore();
    await store.getState().leaveChannel('c-acme');
    expect(store.getState().chats.some((chat) => chat.id === 'c-acme')).toBe(false);
    expect(store.getState().chats.some((chat) => chat.id === 'c-studio')).toBe(true);
  });

  it('mockChangeChannelRole guards the last poster without a store', () => {
    expect(() => mockChangeChannelRole('g-nope', 'u-x', 'admin')).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => mockChangeChannelRole('g-studio', 'u-ghost', 'admin')).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});
