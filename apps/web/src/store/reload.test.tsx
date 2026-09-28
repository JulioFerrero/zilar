import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, XmppCore } from '@galena/xmpp-core';
import { AuthProvider } from '@/auth/AuthProvider';
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
      email: 'me@galena.test',
      name: 'Me',
      image: null,
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
    ]),
    getContacts: vi.fn(async () => [{ userId: 'u-ana', name: 'Ana', jid: 'ana@galena.test' }]),
    getGroup: vi.fn(async () => ({ id: 'g1', title: 'Team', createdBy: 'u-me', members: [] })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@galena.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'galena.test',
      mucDomain: 'rooms.galena.test',
    })),
    createGroup: vi.fn(async () => ({
      id: 'g2',
      title: 'New',
      createdBy: 'u-me',
      members: [],
    })),
    createInvite: vi.fn(async () => ({ code: 'c', url: 'http://x/invite/c' })),
  };
}

function fakeXmpp(): { core: XmppCore; history: Record<string, ChatMessage[]> } {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const history: Record<string, ChatMessage[]> = {
    'ana@galena.test': [
      {
        id: 'ana-1',
        kind: 'chat',
        chatJid: 'ana@galena.test',
        fromJid: 'ana@galena.test',
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
  return { core, history };
}

describe('reload on /c/<jid> (T-0042)', () => {
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
          user: { id: 'u-me', name: 'Me', email: 'me@galena.test' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={store}>
          <MemoryRouter initialEntries={['/c/ana@galena.test']}>
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
    const pageLoads = vi
      .mocked(xmpp.core.loadHistory)
      .mock.calls.filter(([jid, , options]) => jid === 'ana@galena.test' && options?.max === 50);
    expect(pageLoads).toHaveLength(1);
  });
});
