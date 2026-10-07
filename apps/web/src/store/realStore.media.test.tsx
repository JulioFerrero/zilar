import { describe, expect, it, vi } from 'vitest';
import type { Occupant, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { MediaPage } from '@/lib/api';
import { createRealChatStore, type ApiClient, type StorageLike } from './realStore';

// Sign-out must not hit Better Auth over the network in a test.
vi.mock('@/lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => ({})) },
}));

// The server-owner answer is cached per session and must not outlive sign-out.
vi.mock('@/lib/useIsServerOwner', () => ({ resetIsServerOwnerCache: vi.fn() }));

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

interface FakeXmpp {
  core: XmppCore;
  options: { current?: XmppCoreOptions };
}

function fakeXmpp(): FakeXmpp {
  const options: { current?: XmppCoreOptions } = {};
  const core = {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn((): Occupant[] => []),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    sendReactions: vi.fn(async () => {}),
    sendCorrection: vi.fn(async () => ({ id: 'edit-1' })),
    sendRetraction: vi.fn(async () => {}),
    requestUploadSlot: vi.fn(async () => ({
      putUrl: 'http://upload.zilar.test/put/1',
      getUrl: 'http://upload.zilar.test/get/1/file',
      headers: {},
    })),
    loadHistory: vi.fn(async () => ({ messages: [], complete: true })),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: (() => () => {}) as unknown as XmppCore['on'],
  } as unknown as XmppCore;
  return { core, options };
}

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      image: null,
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
    ]),
    getContacts: vi.fn(async () => [{ userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' }]),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
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
    createGroup: vi.fn(async () => ({
      id: 'g2',
      title: 'New',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    createInvite: vi.fn(async () => ({ code: 'c', url: 'http://x/invite/c' })),
    createGroupInviteLink: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listGroupInviteLinks: vi.fn(async () => []),
    listGroupMembers: vi.fn(async () => []),
    revokeGroupInviteLink: vi.fn(async () => {}),
    previewJoinLink: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    joinByLink: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    changeGroupMemberRole: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    removeGroupMember: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    setGroupVisibility: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    searchDirectory: vi.fn(async () => ({ entries: [], next: null })),
    lookupGroupByHandle: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    joinPublicGroup: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listAis: vi.fn(async () => []),
    addGroupAi: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    removeGroupAi: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    createTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    getTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    patchTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    archiveTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listGroupTopics: vi.fn(async () => []),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    removeTopicMember: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    removeTopicAi: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    setTopicRoles: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    setMembersCanCreateTopics: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    listChatPrefs: vi.fn(async () => []),
    getChatBackgroundDefault: vi.fn(async () => ({
      backgroundPreset: null,
      backgroundImageId: null,
      backgroundDim: null,
    })),
    putChatPref: vi.fn(async () => null),
    listPins: vi.fn(async () => []),
    listChatMedia: vi.fn(async () => ({ items: [], next: null })),
    pinMessage: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    unpinMessage: vi.fn(async () => {}),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setup(overrides: Partial<ApiClient> = {}) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
  });
  store.getState().start();
  await flush();
  return { store, api };
}

function page(items: MediaPage['items']): MediaPage {
  return { items, next: null };
}

describe('real store media gallery (T-0434)', () => {
  it('drops the url of an image or gif on an untrusted host', async () => {
    const { store } = await setup({
      listChatMedia: vi.fn(async () =>
        page([
          {
            messageId: 'm-1',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:00:00.000Z',
            senderName: 'Ana',
            kind: 'image',
            url: 'https://evil.test/tracker.png',
            name: 'tracker.png',
          },
          {
            messageId: 'm-2',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:01:00.000Z',
            senderName: 'Ana',
            kind: 'image',
            url: 'https://upload.zilar.test/stage.png',
            name: 'stage.png',
          },
          {
            messageId: 'm-3',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:02:00.000Z',
            senderName: 'Ana',
            kind: 'gif',
            url: 'https://evil.test/loop.gif',
          },
          {
            messageId: 'm-4',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:03:00.000Z',
            senderName: 'Ana',
            kind: 'file',
            url: 'https://evil.test/tickets.pdf',
            name: 'tickets.pdf',
          },
        ]),
      ),
    });

    const result = await store.getState().loadChatMedia('ana@zilar.test', 'media');

    expect(result.items[0]?.url).toBeUndefined();
    expect(result.items[1]?.url).toBe('https://upload.zilar.test/stage.png');
    expect(result.items[2]?.url).toBeUndefined();
    // Files never auto-load, so their url is kept.
    expect(result.items[3]?.url).toBe('https://evil.test/tickets.pdf');
  });

  it('drops every image url when there is no XMPP token yet', async () => {
    const api = fakeApi({
      listChatMedia: vi.fn(async () =>
        page([
          {
            messageId: 'm-1',
            chat: 'ana@zilar.test',
            at: '2026-10-05T10:00:00.000Z',
            senderName: 'Ana',
            kind: 'image',
            url: 'https://upload.zilar.test/stage.png',
            name: 'stage.png',
          },
        ]),
      ),
    });
    const store = createRealChatStore({ api, storage: memoryStorage() });

    const result = await store.getState().loadChatMedia('ana@zilar.test', 'media');

    expect(result.items[0]?.url).toBeUndefined();
  });
});
