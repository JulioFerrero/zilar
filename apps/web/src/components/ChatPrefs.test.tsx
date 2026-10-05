import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ChatSummary } from '@zilar/chat-core';
import type { ChatPref } from '@/lib/api';
import { renderApp } from '@/test/renderApp';

function dm(id: string, title: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function topic(
  id: string,
  title: string,
  groupId: string,
  overrides: Partial<ChatSummary> = {},
): ChatSummary {
  return {
    id,
    title,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    groupId,
    groupTitle: 'Dev team',
    topic: {
      id: `t-${id}`,
      glyph: title.charAt(0),
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  };
}

function general(id: string, groupId: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return topic(id, 'General', groupId, {
    topic: {
      id: `t-${id}`,
      glyph: 'G',
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral: true,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  });
}

// Component tests fake `fetch` themselves (the mock HTTP layer is off under
// `MODE=test`): an in-memory pref endpoint mirroring the server contract.
function stubPrefApi() {
  const prefs = new Map<string, ChatPref>();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api', '');
    if (path === '/chat-prefs' && (init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify({ prefs: [...prefs.values()] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const match = /^\/chat-prefs\/(.+)$/.exec(path);
    if (match?.[1] !== undefined && init?.method === 'PUT') {
      const chatJid = decodeURIComponent(match[1]);
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const key = chatJid.toLowerCase();
      const existing = prefs.get(key);
      const mutedUntil = !('mutedUntil' in body)
        ? (existing?.mutedUntil ?? null)
        : (body.mutedUntil as string | null);
      const archived = !('archived' in body)
        ? (existing?.archived ?? false)
        : (body.archived as boolean);
      const pinnedAt = !('pinned' in body)
        ? (existing?.pinnedAt ?? null)
        : (body.pinned as boolean)
          ? (existing?.pinnedAt ?? new Date().toISOString())
          : null;
      if (mutedUntil === null && archived === false && pinnedAt === null) {
        prefs.delete(key);
        return Promise.resolve(
          new Response(JSON.stringify({ prefs: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      const row: ChatPref = {
        chatJid,
        mutedUntil,
        archived,
        pinnedAt,
        updatedAt: new Date().toISOString(),
      };
      prefs.set(key, row);
      return Promise.resolve(
        new Response(JSON.stringify(row), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { prefs, fetchMock };
}

// The kebab "Archive topic for everyone" patches the topic through the api
// client (fetch), so those tests answer the PATCH with one topic row. An
// archived row (`archived: true`) leaves the list at once; otherwise the
// row stays.
function stubTopicApi({ archived }: { archived: boolean }) {
  const { fetchMock } = stubPrefApi();
  const baseImpl = fetchMock.getMockImplementation();
  if (baseImpl === undefined) {
    throw new Error('expected the pref stub implementation');
  }
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = url.replace('/api', '');
    if (path === '/topics/t-t-bug' && init?.method === 'PATCH') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 't-t-bug',
            groupId: 'g1',
            name: 'Bugs',
            glyph: 'B',
            chatJid: 't-bug',
            visibility: 'public',
            kind: 'chat',
            status: 'open',
            owner: null,
            linkUrl: null,
            linkLabel: null,
            isGeneral: false,
            archived,
            memberCount: 1,
            ais: [],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    }
    return baseImpl(url, init);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat preferences UI', () => {
  it('shows pinned chats first with a pin icon', () => {
    renderApp('/', {
      chats: [dm('b', 'Bravo'), dm('a', 'Alpha', { pinnedAt: new Date('2026-09-30T10:00:00Z') })],
      messagesByChat: {},
    });
    const links = screen.getAllByRole('link').map((link) => link.textContent ?? '');
    expect(links[0]).toContain('Alpha');
    expect(screen.getByLabelText('Pinned')).toBeTruthy();
  });

  it('hides archived chats behind an Archived row that expands', async () => {
    stubPrefApi();
    const { store } = renderApp('/', {
      chats: [dm('a', 'Alpha', { archived: true }), dm('b', 'Bravo')],
      messagesByChat: {},
    });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Bravo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByText('Alpha')).toBeTruthy();

    // Unarchiving from the row menu returns the chat to the main list.
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unarchive chat Alpha' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 'a')?.archived).toBeUndefined();
  });

  it('pins and unpins from the row menu', async () => {
    stubPrefApi();
    const { store } = renderApp('/', { chats: [dm('a', 'Alpha')], messagesByChat: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Alpha' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 'a')?.pinnedAt).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Chat actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Alpha' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 'a')?.pinnedAt).toBeUndefined();
  });

  it('mutes for a duration and unmutes from the row menu', async () => {
    stubPrefApi();
    const { store } = renderApp('/', { chats: [dm('a', 'Alpha')], messagesByChat: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '1 hour' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 'a')?.muted).toBe(true);
  });

  it('excludes muted chats from folder unread totals', () => {
    renderApp('/', {
      chats: [dm('a', 'Alpha', { unread: 3 }), dm('b', 'Bravo', { unread: 5, muted: true })],
      messagesByChat: {},
    });
    // "All" tab badge counts 3, not 8.
    const tab = screen.getByRole('tab', { name: /All/ });
    expect(tab.textContent).toContain('3');
    expect(tab.textContent).not.toContain('8');
  });

  it('shows a muted badge style for muted chats', () => {
    renderApp('/', { chats: [dm('a', 'Alpha', { unread: 2, muted: true })], messagesByChat: {} });
    expect(screen.getByLabelText('2 unread').className).toContain('bg-badge-muted');
    expect(screen.getByLabelText('Muted')).toBeTruthy();
  });

  it('floats a pinned group above unpinned groups via its General row', () => {
    renderApp('/', {
      chats: [
        dm('z', 'Zed'),
        general('g-b', 'gb', { groupTitle: 'Beta' }),
        general('g-a', 'ga', {
          groupTitle: 'Alpha',
          pinnedAt: new Date('2026-09-30T10:00:00Z'),
        }),
      ],
      messagesByChat: {},
    });
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    const text = nav.textContent ?? '';
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Zed'));
    expect(screen.getAllByLabelText('Pinned').length).toBeGreaterThan(0);
  });

  it('floats pinned topics above General inside their group', () => {
    renderApp('/', {
      chats: [
        general('g', 'g1'),
        topic('t-bug', 'Bugs', 'g1', { pinnedAt: new Date('2026-09-30T10:00:00Z') }),
        topic('t-chat', 'Chat', 'g1'),
      ],
      messagesByChat: {},
    });
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    const text = nav.textContent ?? '';
    expect(text.indexOf('Bugs')).toBeLessThan(text.indexOf('General'));
    expect(text.indexOf('General')).toBeLessThan(text.indexOf('Chat'));
  });

  it('shows a per-user archived topic in the group Archived toggle', () => {
    renderApp('/', {
      chats: [
        general('g', 'g1'),
        topic('t-old', 'Old', 'g1', { archived: true }),
        topic('t-new', 'New', 'g1'),
      ],
      messagesByChat: {},
    });
    // The archived topic hides until the group's Archived toggle opens; the
    // bottom per-user Archived row only appears for DMs/AIs.
    expect(screen.queryByText('Old')).toBeNull();
    expect(screen.getByText('New')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByText('Old')).toBeTruthy();
  });

  it('mutes and archives a topic from its row menu', async () => {
    stubTopicApi({ archived: false });
    const { store } = renderApp('/', {
      chats: [general('g', 'g1'), topic('t-bug', 'Bugs', 'g1')],
      messagesByChat: {},
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions for Bugs' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute Bugs' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '1 hour' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 't-bug')?.muted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Chat actions for Bugs' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive chat Bugs' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 't-bug')?.archived).toBe(true);
  });

  it('combines per-user items with the manager entry in the topic header menu', async () => {
    stubTopicApi({ archived: false });
    const { store } = renderApp('/c/t-bug', {
      chats: [general('g', 'g1'), topic('t-bug', 'Bugs', 'g1')],
      messagesByChat: {},
      groupInfos: {
        't-bug': {
          id: 'g1',
          title: 'Dev team',
          createdBy: 'u-you',
          members: [{ userId: 'u-you', name: 'You', role: 'owner' }],
          ais: [],
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    const menu = screen.getByRole('menu', { name: 'Topic actions' });
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toContain('Topic info');
    expect(items).toContain('Search');
    expect(items).toContain('Pin');
    expect(items).toContain('Archive chat');
    // The manager entry sits last, clearly labeled.
    expect(items[items.length - 1]).toContain('Archive topic for everyone');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pin Bugs' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().chats.find((chat) => chat.id === 't-bug')?.pinnedAt).toBeDefined();
  });
});
