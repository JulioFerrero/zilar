import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { MessageList } from '@/components/MessageList';
import { AppRoutes } from '@/routes/AppRoutes';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createRealChatStore, type ApiClient, type StorageLike } from './realStore';

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

function fakeApi(): ApiClient {
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
    setGroupVisibility: vi.fn(async () => {
      throw new Error('not implemented');
    }),
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
    putChatPref: vi.fn(async () => null),
    listPins: vi.fn(async () => []),
    pinMessage: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    unpinMessage: vi.fn(async () => {}),
  };
}

function fakeXmpp(): {
  core: XmppCore;
  history: Record<string, ChatMessage[]>;
  emit: (event: string, payload: unknown) => void;
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const history: Record<string, ChatMessage[]> = {
    'ana@zilar.test': [
      {
        id: 'ana-1',
        kind: 'chat',
        chatJid: 'ana@zilar.test',
        fromJid: 'ana@zilar.test',
        fromResolved: true,
        timestamp: new Date('2026-09-28T10:00:00Z'),
        outgoing: false,
        body: 'hello after reload',
      },
    ],
  };
  const core = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    loadHistory: vi.fn(
      async (chatJid: string, _kind: unknown, options?: { before?: string; max?: number }) => {
        const list = history[chatJid] ?? [];
        const max = options?.max ?? 50;
        const messages = list.slice(-max);
        return { messages, complete: true, first: messages[0]?.id };
      },
    ),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: ((event: string, callback: (payload: unknown) => void) => {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
      };
    }) as unknown as XmppCore['on'],
  } as unknown as XmppCore;
  return {
    core,
    history,
    emit: (event, payload) => {
      for (const callback of listeners.get(event) ?? []) {
        callback(payload);
      }
    },
  };
}

describe('reload on /c/<jid> (T-0042)', () => {
  async function waitForState(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (check()) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('timed out waiting for store state');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function pageLoadCount(xmpp: { core: XmppCore }, chatJid: string): number {
    return vi
      .mocked(xmpp.core.loadHistory)
      .mock.calls.filter(([jid, , options]) => jid === chatJid && options?.max === 50).length;
  }
  it('requests history and renders the messages once the store becomes ready', async () => {
    const api = fakeApi();
    const xmpp = fakeXmpp();
    const store = createRealChatStore({
      api,
      storage: memoryStorage(),
      createXmpp: () => xmpp.core,
    });

    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-me', name: 'Me', email: 'me@zilar.test' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={store}>
          <MemoryRouter initialEntries={['/c/ana@zilar.test']}>
            <AppRoutes />
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );

    // The store becomes ready after a delay, like a real page reload: the
    // chat screen mounts before the core is connected and the chats arrive.
    store.getState().start();

    const messageList = await screen.findByTestId('message-list');
    expect(await within(messageList).findByText('hello after reload')).toBeTruthy();
    expect(pageLoadCount(xmpp, 'ana@zilar.test')).toBe(1);
  });

  it('shows loading on first paint when history was never requested', async () => {
    const api = fakeApi();
    const xmpp = fakeXmpp();
    const store = createRealChatStore({
      api,
      storage: memoryStorage(),
      createXmpp: () => xmpp.core,
    });
    store.getState().start();
    await waitForState(() => store.getState().chatsState === 'ready');
    const chat = store.getState().chats.find((entry) => entry.id === 'ana@zilar.test');
    if (chat === undefined) {
      throw new Error('expected Ana in the chat list');
    }

    // Render the message list directly, without opening the chat: this is the
    // first paint ChatView produces before its openChat effect runs.
    render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-me', name: 'Me', email: 'me@zilar.test' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={store}>
          <MessageList chat={chat} onReply={() => {}} />
        </ChatStoreProvider>
      </AuthProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });

  it('loads the pending chat when the connection comes online (reconnect)', async () => {
    const api = fakeApi();
    const xmpp = fakeXmpp();
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    vi.mocked(xmpp.core.connect).mockImplementationOnce(() => connectGate);
    const store = createRealChatStore({
      api,
      storage: memoryStorage(),
      createXmpp: () => xmpp.core,
    });

    store.getState().openChat('ana@zilar.test');
    store.getState().start();
    // The chats merged but the connection is still down: nothing loads yet.
    await waitForState(() => store.getState().chatsState === 'ready');
    expect(pageLoadCount(xmpp, 'ana@zilar.test')).toBe(0);

    // The reconnect completes: the pending open runs exactly once.
    xmpp.emit('status', 'online');
    await waitForState(() => store.getState().messages('ana@zilar.test').length > 0);
    await waitForState(() => pageLoadCount(xmpp, 'ana@zilar.test') === 1);
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .map((item) => item.text),
    ).toContain('hello after reload');

    releaseConnect();
  });
});
