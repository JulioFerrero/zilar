import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry, GroupMember } from '../lib/chat-api';
import type { GroupsApi } from '../lib/groups-api';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApi, fakeAppState } from './test-support';
import { flushTasks as flush } from '@/test/wait';

function generalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-acme-feed',
    groupId: 'g-acme',
    name: 'General',
    glyph: 'G',
    chatJid: 'acme@rooms.zilar.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: true,
    archived: false,
    memberCount: 4,
    owner: null,
    linkUrl: null,
    linkLabel: null,
    ais: [],
    roles: [],
    approverRole: null,
    ...overrides,
  };
}

function channelEntry(): ChatEntry {
  return {
    kind: 'group',
    chatJid: 'acme@rooms.zilar.test',
    title: 'Acme Announcements',
    groupId: 'g-acme',
    memberCount: 4,
    role: 'member',
    chatKind: 'channel',
    subscriberCount: 4,
    description: 'Release notes.',
    topics: [generalRow()],
  } as unknown as ChatEntry;
}

function channelApi() {
  return fakeApi({
    getChats: vi.fn(async (): Promise<ChatEntry[]> => [channelEntry()]),
    getGroup: vi.fn(async () => ({
      id: 'g-acme',
      title: 'Acme Announcements',
      createdBy: 'u-rita',
      kind: 'channel' as const,
      description: 'Release notes.',
      members: [] as GroupMember[],
      ais: [],
    })),
  });
}

function fakeGroups(): GroupsApi & { calls: { role: { userId: string; role: string }[] } } {
  const calls = { role: [] as { userId: string; role: string }[] };
  return {
    calls,
    createChannel: vi.fn(async (_input: { title: string; description?: string }) => ({
      id: 'g-new',
    })),
    createGroup: vi.fn(async (_input: { title: string; memberIds: string[] }) => ({
      id: 'g-new',
    })),
    listGroupMembers: vi.fn(async () => [
      { userId: 'u-rita', name: 'Rita', role: 'owner' as const, roles: [] },
      { userId: 'u-ana', name: 'Ana', role: 'admin' as const, roles: [] },
    ]),
    changeGroupMemberRole: vi.fn(async (_groupId: string, userId: string, role: string) => {
      calls.role.push({ userId, role });
    }),
    removeGroupMember: vi.fn(async () => {}),
  };
}

function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = channelApi();
  const groups = fakeGroups();
  const store = createRealChatStore({
    api,
    groupsApi: groups,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => createFakeXmppCore(),
    ...deps,
  });
  return { store, api, groups };
}

describe('real store channels (T-0144)', () => {
  it('maps the feed row as a channel with the count, blurb and role', async () => {
    const { store } = setup();
    store.getState().start();
    await flush();

    const feed = store.getState().chats.find((chat) => chat.id === 'acme@rooms.zilar.test');
    expect(feed).toMatchObject({
      chatKind: 'channel',
      subscriberCount: 4,
      description: 'Release notes.',
      myRole: 'member',
    });
  });

  it('creates a channel and refreshes the list', async () => {
    const { store, groups, api } = setup();
    store.getState().start();
    await flush();

    const id = await store.getState().createChannel({ title: 'Releases' });
    expect(id).toBe('g-new');
    expect(groups.createChannel).toHaveBeenCalledWith({ title: 'Releases' });
    // The list refreshes after the create, like the group flow.
    expect(vi.mocked(api.getChats).mock.calls.length).toBeGreaterThan(1);
  });

  it('rejects a blank channel name without touching the network', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    await expect(store.getState().createChannel({ title: '   ' })).rejects.toThrow(
      'Enter a channel name.',
    );
    expect(groups.createChannel).not.toHaveBeenCalled();
  });

  it('rejects a description over 300 characters without touching the network', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    await expect(
      store.getState().createChannel({ title: 'Releases', description: 'x'.repeat(301) }),
    ).rejects.toThrow('at most 300');
    expect(groups.createChannel).not.toHaveBeenCalled();
  });

  it('reads the admins slice through listChannelMembers', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    await expect(store.getState().listChannelMembers('g-acme')).resolves.toEqual([
      { userId: 'u-rita', name: 'Rita', role: 'owner', roles: [] },
      { userId: 'u-ana', name: 'Ana', role: 'admin', roles: [] },
    ]);
    expect(groups.listGroupMembers).toHaveBeenCalledWith('g-acme');
  });

  it('changes a role through the role route and refreshes the list', async () => {
    const { store, groups, api } = setup();
    store.getState().start();
    await flush();
    const callsBefore = vi.mocked(api.getChats).mock.calls.length;

    await store.getState().changeChannelRole('acme@rooms.zilar.test', 'u-luis', 'admin');
    expect(groups.calls.role).toEqual([{ userId: 'u-luis', role: 'admin' }]);
    // The acting device re-reads the list, so the rows (myRole, counts)
    // match server truth and the composer bar flips.
    expect(vi.mocked(api.getChats).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('leaves through the member route and refreshes the list', async () => {
    const { store, groups, api } = setup();
    store.getState().start();
    await flush();
    const callsBefore = vi.mocked(api.getChats).mock.calls.length;

    await store.getState().leaveChannel('acme@rooms.zilar.test');
    expect(groups.removeGroupMember).toHaveBeenCalledWith('g-acme', 'u-me');
    expect(vi.mocked(api.getChats).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
