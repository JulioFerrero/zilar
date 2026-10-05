import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry, GroupMember } from '../lib/chat-api';
import type { GroupsApi } from '../lib/groups-api';
import { createRealChatStore, type AppStateLike, type RealStoreDeps } from './real-store';

function fakeAppState(): AppStateLike {
  return { current: () => 'active', subscribe: () => () => {} };
}

function fakeApi() {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async (): Promise<ChatEntry[]> => []),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g-new',
      title: 'Weekend club',
      createdBy: 'u-me',
      kind: 'group' as const,
      description: null,
      members: [] as GroupMember[],
      ais: [],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
  };
}

function fakeCore(): unknown {
  return {
    status: () => 'online',
    connect: async () => {},
    disconnect: async () => {},
    joinRoom: async () => {},
    occupants: () => [],
    sendMessage: async () => ({ id: 'srv-1' }),
    sendReactions: async () => {},
    sendCorrection: async () => ({ id: 'srv-c' }),
    sendRetraction: async () => {},
    loadHistory: async () => ({ messages: [], complete: true, first: undefined }),
    sendTyping: () => {},
    markDisplayed: () => {},
    on: () => () => {},
  };
}

function fakeGroups(): GroupsApi & {
  createGroup: ReturnType<typeof vi.fn>;
} {
  return {
    createChannel: vi.fn(async () => ({ id: 'g-channel' })),
    createGroup: vi.fn(async (_input: { title: string; memberIds: string[] }) => ({
      id: 'g-new',
    })),
    listGroupMembers: vi.fn(async () => []),
    changeGroupMemberRole: vi.fn(async () => {}),
    removeGroupMember: vi.fn(async () => {}),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApi();
  const groups = fakeGroups();
  const store = createRealChatStore({
    api,
    groupsApi: groups,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => fakeCore() as never,
    ...deps,
  });
  return { store, api, groups };
}

describe('real store createGroup (T-0214)', () => {
  it('trims the title, calls the API with the member ids, refreshes, returns the id', async () => {
    const { store, groups, api } = setup();
    store.getState().start();
    await flush();

    const id = await store.getState().createGroup({
      title: '  Weekend club  ',
      memberIds: ['u-ana', 'u-luis'],
    });
    expect(id).toBe('g-new');
    expect(groups.createGroup).toHaveBeenCalledWith({
      title: 'Weekend club',
      memberIds: ['u-ana', 'u-luis'],
    });
    // The list refreshes after the create, like the channel flow.
    expect(vi.mocked(api.getChats).mock.calls.length).toBeGreaterThan(1);
  });

  it('rejects a blank group name without touching the network', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    await expect(
      store.getState().createGroup({ title: '   ', memberIds: ['u-ana'] }),
    ).rejects.toThrow('Enter a group name.');
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  it('resolves the id even when the background refresh fails', async () => {
    const failingApi = {
      ...fakeApi(),
      getChats: vi.fn(async (): Promise<ChatEntry[]> => {
        throw new Error('offline');
      }),
    };
    const { store, groups } = setup({ api: failingApi as never });
    store.getState().start();
    await flush();

    // Refresh failures are swallowed (`.catch(() => {})`), like channels.
    const id = await store.getState().createGroup({
      title: 'Weekend club',
      memberIds: [],
    });
    expect(id).toBe('g-new');
    expect(groups.createGroup).toHaveBeenCalledWith({ title: 'Weekend club', memberIds: [] });
  });
});

describe('real store public creates (T-0228)', () => {
  it('forwards the trimmed visibility and handle for a public group', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    const id = await store.getState().createGroup({
      title: 'Weekend club',
      memberIds: ['u-ana'],
      visibility: 'public',
      handle: '  hiking_club  ',
    });
    expect(id).toBe('g-new');
    expect(groups.createGroup).toHaveBeenCalledWith({
      title: 'Weekend club',
      memberIds: ['u-ana'],
      visibility: 'public',
      handle: 'hiking_club',
    });
  });

  it('sends neither visibility nor handle for a private group', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    await store.getState().createGroup({ title: 'Weekend club', memberIds: ['u-ana'] });
    expect(groups.createGroup).toHaveBeenCalledWith({
      title: 'Weekend club',
      memberIds: ['u-ana'],
    });
  });

  it('forwards the trimmed visibility and handle for a public channel', async () => {
    const { store, groups } = setup();
    store.getState().start();
    await flush();

    const id = await store.getState().createChannel({
      title: 'Releases',
      visibility: 'public',
      handle: '  hiking_club  ',
    });
    expect(id).toBe('g-channel');
    expect(groups.createChannel).toHaveBeenCalledWith({
      title: 'Releases',
      visibility: 'public',
      handle: 'hiking_club',
    });
  });
});
