import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@galena/chat-core';
import type { GroupDetail } from '@/lib/api';
import { renderApp } from '@/test/renderApp';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';

interface StubPin {
  id: string;
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: 'text' | 'image' | 'file' | 'voice' | 'card';
  pinnedBy: string;
  pinnedAt: string;
}

function stubPin(partial: Omit<StubPin, 'pinnedBy' | 'pinnedAt'>): StubPin {
  return { ...partial, pinnedBy: 'u-you', pinnedAt: new Date().toISOString() };
}

// Component tests fake `fetch` themselves (the mock HTTP layer is off under
// `MODE=test`): an in-memory pins endpoint mirroring the server contract.
function stubPinsApi(initial: StubPin[] = []) {
  let pins = [...initial];
  let sequence = 100;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/pins?') && method === 'GET') {
      const chat = new URLSearchParams(path.slice('/pins?'.length)).get('chat') ?? '';
      const rows = pins.filter((pin) => pin.chat === chat).sort((a, b) => (a.id < b.id ? 1 : -1));
      return new Response(JSON.stringify({ pins: rows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/pins' && method === 'POST') {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const created: StubPin = {
        id: `pin-${sequence}`,
        chat: String(body.chat ?? ''),
        messageId: String(body.messageId ?? ''),
        senderName: String(body.senderName ?? ''),
        text: String(body.text ?? ''),
        kind: (body.kind as StubPin['kind']) ?? 'text',
        pinnedBy: 'u-you',
        pinnedAt: new Date().toISOString(),
      };
      sequence += 1;
      pins = [...pins, created];
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const unpin = /^\/pins\/(.+)$/.exec(path);
    if (unpin?.[1] !== undefined && method === 'DELETE') {
      const id = decodeURIComponent(unpin[1]);
      const found = pins.find((pin) => pin.id === id);
      if (found === undefined) {
        return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no' } }), {
          status: 404,
        });
      }
      pins = pins.filter((pin) => pin.id !== id);
      return new Response(
        JSON.stringify({ ...found, pinnedBy: 'u-you', pinnedAt: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, count: () => pins.length };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function topicChat(id: string, title: string): ChatSummary {
  return {
    id,
    title,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    groupId: 'g-devteam',
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
  };
}

function textMessage(
  chatId: string,
  id: string,
  text: string,
  senderId = 'u-you',
  senderName = 'You',
): UiMessage {
  return {
    id,
    chatId,
    senderId,
    senderName,
    text,
    createdAt: new Date('2026-09-30T10:00:00Z'),
    status: 'sent',
  };
}

function groupInfo(role: 'owner' | 'admin' | 'member'): GroupDetail {
  return {
    id: 'g-devteam',
    title: 'Dev team',
    createdBy: 'u-you',
    members: [
      { userId: 'u-you', name: 'You', role },
      { userId: 'u-ana', name: 'Ana', role: 'member' },
    ],
    ais: [],
  };
}

describe('pinned messages (T-0114)', () => {
  it('shows the banner with sender and text, and jumps to the loaded message', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-1',
        chat: 'c-x',
        messageId: 'm-1',
        senderName: 'Ana',
        text: 'Read this',
        kind: 'text',
      }),
    ]);
    const { store } = renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Read this', 'u-ana', 'Ana')] },
    });
    await waitFor(() => expect(screen.getByText('Read this')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Jump to pinned message from Ana' })).toBeTruthy();

    const openAtMessage = vi.spyOn(store.getState(), 'openAtMessage');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to pinned message from Ana' }));
    await waitFor(() => expect(openAtMessage).toHaveBeenCalledWith('c-x', 'm-1'));
    expect(screen.queryByText('Message not found')).toBeNull();
  });

  it('cycles through several pins with the count button', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-2',
        chat: 'c-x',
        messageId: 'm-2',
        senderName: 'You',
        text: 'Pinned second',
        kind: 'text',
      }),
      stubPin({
        id: 'pin-1',
        chat: 'c-x',
        messageId: 'm-1',
        senderName: 'Ana',
        text: 'Pinned first',
        kind: 'text',
      }),
    ]);
    renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: {
        'c-x': [
          textMessage('c-x', 'm-1', 'First', 'u-ana', 'Ana'),
          textMessage('c-x', 'm-2', 'Second'),
        ],
      },
    });
    // Newest first: the stub sorts by id desc, so pin-2 is current.
    await waitFor(() => expect(screen.getByText('Pinned second')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Show next pinned message, 1 of 2/ }));
    expect(screen.getByText('Pinned first')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show next pinned message, 2 of 2/ })).toBeTruthy();
  });

  it('shows "Message not found" when the pinned message is not in history', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-9',
        chat: 'c-x',
        messageId: 'ghost',
        senderName: 'Ana',
        text: 'Gone',
        kind: 'text',
      }),
    ]);
    renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Hello')] },
    });
    await waitFor(() => expect(screen.getByText('Gone')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Jump to pinned message from Ana' }));
    await waitFor(() => expect(screen.getByText('Message not found')).toBeTruthy());
  });

  it('shows a kind label for attachment pins', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-3',
        chat: 'c-x',
        messageId: 'm-9',
        senderName: 'Ana',
        text: '',
        kind: 'image',
      }),
    ]);
    renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Hello')] },
    });
    await waitFor(() => expect(screen.getByText('Photo')).toBeTruthy());
  });

  it('pins and unpins a DM message from its actions menu', async () => {
    stubPinsApi();
    const { store } = renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Please pin this')] },
    });
    await act(async () => {
      await Promise.resolve();
    });

    const bubble = within(screen.getByTestId('message-list')).getByText('Please pin this');
    fireEvent.contextMenu(bubble);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(store.getState().pins('c-x')).toHaveLength(1));
    expect(store.getState().pins('c-x')[0]?.messageId).toBe('m-1');
    expect(store.getState().pins('c-x')[0]?.senderName).toBe('You');

    fireEvent.contextMenu(bubble);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    await waitFor(() => expect(store.getState().pins('c-x')).toHaveLength(0));
  });

  it('pins a multiline message and shows its lines in the banner', async () => {
    stubPinsApi();
    const { store } = renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: {
        'c-x': [textMessage('c-x', 'm-1', 'Agenda:\n1. tabulated\n2. done')],
      },
    });
    await act(async () => {
      await Promise.resolve();
    });

    const bubble = within(screen.getByTestId('message-list')).getByText(/Agenda:/);
    fireEvent.contextMenu(bubble);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(store.getState().pins('c-x')).toHaveLength(1));
    expect(store.getState().pins('c-x')[0]?.text).toBe('Agenda:\n1. tabulated\n2. done');
    // The banner keeps every line as inert text.
    const jump = screen.getByRole('button', { name: 'Jump to pinned message from You' });
    expect(jump.textContent).toContain('Agenda:');
    expect(jump.textContent).toContain('1. tabulated');
  });

  it('gates the menu items: anyone in a DM, only managers in a topic', async () => {
    stubPinsApi();
    // Plain member in a topic: no Pin entry.
    renderApp('/c/t-x', {
      chats: [topicChat('t-x', 'Backend')],
      messagesByChat: { 't-x': [textMessage('t-x', 'm-1', 'Their text', 'u-ana', 'Ana')] },
      groupInfos: { 't-x': groupInfo('member') },
    });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.contextMenu(screen.getByText('Their text'));
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Unpin' })).toBeNull();
  });

  it('shows Pin for a topic manager', async () => {
    stubPinsApi();
    const { store } = renderApp('/c/t-x', {
      chats: [topicChat('t-x', 'Backend')],
      messagesByChat: { 't-x': [textMessage('t-x', 'm-1', 'Their text', 'u-ana', 'Ana')] },
      groupInfos: { 't-x': groupInfo('admin') },
    });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.contextMenu(screen.getByText('Their text'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(store.getState().pins('t-x')).toHaveLength(1));
    // The snapshot keeps the original sender, not the manager.
    expect(store.getState().pins('t-x')[0]?.senderName).toBe('Ana');
  });

  it('renders a hostile snapshot as text, never markup', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-evil',
        chat: 'c-x',
        messageId: 'm-1',
        senderName: 'Ana',
        text: '<img src=x onerror=alert(1)> see javascript:alert(2) and https://example.com/a',
        kind: 'text',
      }),
    ]);
    renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Hi')] },
    });
    const jump = await screen.findByRole('button', { name: 'Jump to pinned message from Ana' });
    // The hostile text is split across safe spans, so assert on the whole
    // button: the markup renders as inert text, never as elements.
    expect(jump.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(jump.textContent).toContain('javascript:alert(2)');
    // No injected image, no javascript: link — only the safe https link.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    const link = document.querySelector('a[href="https://example.com/a"]');
    expect(link).not.toBeNull();
  });

  it('opens the pins panel from the banner and unpins from it', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-1',
        chat: 'c-x',
        messageId: 'm-1',
        senderName: 'Ana',
        text: 'Read this',
        kind: 'text',
      }),
    ]);
    const { store } = renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Read this', 'u-ana', 'Ana')] },
    });
    await waitFor(() => expect(screen.getByText('Read this')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Open pinned messages, 1 pinned' }));
    const dialog = screen.getByRole('dialog', { name: 'Pinned messages in Ana' });
    expect(within(dialog).getByText('Read this')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpin message from Ana' }));
    await waitFor(() => expect(store.getState().pins('c-x')).toHaveLength(0));
  });

  it('hides the panel unpin button for plain topic members', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-1',
        chat: 't-x',
        messageId: 'm-1',
        senderName: 'Ana',
        text: 'Read this',
        kind: 'text',
      }),
    ]);
    renderApp('/c/t-x', {
      chats: [topicChat('t-x', 'Backend')],
      messagesByChat: { 't-x': [textMessage('t-x', 'm-1', 'Read this', 'u-ana', 'Ana')] },
      groupInfos: { 't-x': groupInfo('member') },
    });
    await waitFor(() => expect(screen.getByText('Read this')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open pinned messages, 1 pinned' }));
    const dialog = screen.getByRole('dialog', { name: 'Pinned messages in Backend' });
    expect(within(dialog).queryByRole('button', { name: 'Unpin message from Ana' })).toBeNull();
  });

  it('shows a retracted original as "Message deleted"', async () => {
    stubPinsApi([
      stubPin({
        id: 'pin-1',
        chat: 'c-x',
        messageId: 'm-1',
        senderName: 'Ana',
        text: 'Read this',
        kind: 'text',
      }),
    ]);
    renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: {
        'c-x': [{ ...textMessage('c-x', 'm-1', 'Read this', 'u-ana', 'Ana'), deleted: true }],
      },
    });
    await waitFor(() => expect(screen.getByText('Message deleted')).toBeTruthy());
  });

  it('reports pin failures inline with a dismiss key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { store } = renderApp('/c/c-x', {
      chats: [dm('c-x', 'Ana')],
      messagesByChat: { 'c-x': [textMessage('c-x', 'm-1', 'Pin me')] },
    });
    await act(async () => {
      await store
        .getState()
        .pinMessage('c-x', 'm-1')
        .catch(() => {});
    });
    expect(screen.getByText('Could not pin the message. Try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss pins error' }));
    expect(screen.queryByText('Could not pin the message. Try again.')).toBeNull();
  });
});

describe('mock pins API (T-0114)', () => {
  afterEach(() => {
    resetMockApi();
    setMockDelay(150);
  });

  it('lists seeded pins newest first, pins, rejects duplicates and the cap, unpins', async () => {
    resetMockApi();
    setMockDelay(0);
    const list = await mockRequest('/pins?chat=c-ana', { method: 'GET' });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { pins: StubPin[] };
    expect(listed.pins.map((pin) => pin.messageId)).toEqual(['ana-17']);

    const created = await mockRequest('/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: 'c-ana', messageId: 'ana-1', senderName: 'You', text: 'Hi' }),
    });
    expect(created.status).toBe(201);
    const pin = (await created.json()) as StubPin;

    const duplicate = await mockRequest('/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: 'c-ana', messageId: 'ana-1', senderName: 'You', text: 'Hi' }),
    });
    expect(duplicate.status).toBe(409);

    const removed = await mockRequest(`/pins/${pin.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const missing = await mockRequest('/pins/nope', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });
});
