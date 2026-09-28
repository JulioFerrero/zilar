import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ChatSummary } from '@galena/chat-core';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { createChatStore } from '@/store/store';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { ChatView } from '@/routes/ChatView';
import { AiPanel } from './AiPanel';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@galena.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'ai-a-1@galena.test',
  title: 'Dev-1',
  kind: 'dm',
  isAI: true,
  space: 'personal',
  unread: 0,
  muted: false,
};

const ai = {
  id: 'a-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'You are a concise senior engineer.',
  model: 'gpt-4o',
  jid: 'ai-a-1@galena.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  createdAt: '2026-09-28T00:00:00.000Z',
};

function methodOf(call: unknown[]): string {
  return (call[1] as RequestInit | undefined)?.method ?? 'GET';
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

function renderPanel() {
  const store = createChatStore({ chats: [chat] });
  const onClose = vi.fn();
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/c/ai-a-1@galena.test']}>
          <Routes>
            <Route path="/c/:chatJid" element={<AiPanel chat={chat} onClose={onClose} />} />
            <Route path="/" element={<div>Chat list</div>} />
          </Routes>
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiPanel', () => {
  it('loads the AI by the chat jid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [ai])));

    renderPanel();

    expect(await screen.findByDisplayValue('Dev-1')).toBeTruthy();
    expect(screen.getByDisplayValue('You are a concise senior engineer.')).toBeTruthy();
    expect(screen.getByText('gpt-4o')).toBeTruthy();
  });

  it('PATCHes only the changed fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [ai]))
      .mockResolvedValueOnce(jsonResponse(200, { ...ai, persona: 'Be a pirate.' }));
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    const persona = await screen.findByDisplayValue('You are a concise senior engineer.');
    fireEvent.change(persona, { target: { value: 'Be a pirate.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => methodOf(c) === 'PATCH')).toBe(true),
    );
    const patch = fetchMock.mock.calls.find((call) => methodOf(call) === 'PATCH')!;
    expect(bodyOf(patch)).toEqual({ persona: 'Be a pirate.' });
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows the new delete text, then deletes and goes home', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [ai]))
      .mockResolvedValueOnce(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    const { store } = renderPanel();
    await screen.findByDisplayValue('Dev-1');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      screen.getByText(
        'Delete Dev-1? This removes the AI and its chat. Your provider connection stays.',
      ),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.filter((call) => methodOf(call) === 'DELETE')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((call) => methodOf(call) === 'DELETE')).toHaveLength(1),
    );
    expect(await screen.findByText('Chat list')).toBeTruthy();
    expect(store.getState().chats.some((item) => item.id === chat.id)).toBe(false);
  });

  it('shows the gone state for an unknown AI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderPanel();

    expect(await screen.findByText('This AI no longer exists.')).toBeTruthy();
  });

  it('opens from the AI chat header title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [ai])));
    const store = createChatStore({ chats: [chat] });

    render(
      <AuthProvider value={auth}>
        <ChatStoreProvider store={store}>
          <MemoryRouter initialEntries={['/c/ai-a-1@galena.test']}>
            <Routes>
              <Route path="/c/:chatJid" element={<ChatView chat={chat} />} />
              <Route path="/" element={<div>Chat list</div>} />
            </Routes>
          </MemoryRouter>
        </ChatStoreProvider>
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open Dev-1 settings' }));

    expect(await screen.findByRole('dialog', { name: 'Dev-1 AI settings' })).toBeTruthy();
  });
});
