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

const openaiConnection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Main key',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const anthropicConnection = {
  id: 'c-2',
  provider: 'anthropic',
  label: 'Backup key',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

function methodOf(call: unknown[]): string {
  return (call[1] as RequestInit | undefined)?.method ?? 'GET';
}

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body as string);
}

function patchesTo(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter((call) => methodOf(call) === 'PATCH');
}

// The panel loads the AI list and the connections list; PATCH answers come
// from `patch` (a body) or fail with `patchError`.
function mockPanelFetch(
  connections: unknown[] = [openaiConnection],
  patch: unknown = { ...ai },
  patchError?: { status: number; message: string },
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    if ((init?.method ?? 'GET') === 'PATCH') {
      if (patchError !== undefined) {
        return jsonResponse(patchError.status, {
          error: { code: 'ai_update_failed', message: patchError.message },
        });
      }
      return jsonResponse(200, patch);
    }
    if (target.includes('/connections')) {
      return jsonResponse(200, connections);
    }
    if ((init?.method ?? 'GET') === 'DELETE') {
      return jsonResponse(204, null);
    }
    return jsonResponse(200, [ai]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
    mockPanelFetch();

    renderPanel();

    expect(await screen.findByDisplayValue('Dev-1')).toBeTruthy();
    expect(screen.getByDisplayValue('You are a concise senior engineer.')).toBeTruthy();
    expect(screen.getByDisplayValue('gpt-4o')).toBeTruthy();
  });

  it('PATCHes only the changed fields', async () => {
    const fetchMock = mockPanelFetch([openaiConnection], { ...ai, persona: 'Be a pirate.' });

    renderPanel();
    const persona = await screen.findByDisplayValue('You are a concise senior engineer.');
    fireEvent.change(persona, { target: { value: 'Be a pirate.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchesTo(fetchMock)).toHaveLength(1));
    expect(bodyOf(patchesTo(fetchMock)[0]!)).toEqual({ persona: 'Be a pirate.' });
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows the new delete text, then deletes and goes home', async () => {
    const fetchMock = mockPanelFetch();

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

  it('shows the connection picker only with several connections, prefilled', async () => {
    mockPanelFetch([openaiConnection, anthropicConnection]);

    renderPanel();
    await screen.findByDisplayValue('gpt-4o');

    const picker = screen.getByRole('radiogroup', { name: 'Provider connection' });
    expect(picker).toBeTruthy();
    expect(screen.getByRole('radio', { name: /OpenAI/, checked: true })).toBeTruthy();
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4o');
  });

  it('hides the connection picker with one connection but keeps the model picker', async () => {
    mockPanelFetch([openaiConnection]);

    renderPanel();
    await screen.findByDisplayValue('gpt-4o');

    expect(screen.queryByRole('radiogroup', { name: 'Provider connection' })).toBeNull();
    expect(screen.getByLabelText('Model')).toBeTruthy();
  });

  it('sends only a changed model and shows the new model after saving', async () => {
    const fetchMock = mockPanelFetch([openaiConnection], { ...ai, model: 'gpt-4o-mini' });

    const { store } = renderPanel();
    const model = (await screen.findByLabelText('Model')) as HTMLInputElement;
    expect(model.value).toBe('gpt-4o');

    fireEvent.change(model, { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchesTo(fetchMock)).toHaveLength(1));
    expect(bodyOf(patchesTo(fetchMock)[0]!)).toEqual({ model: 'gpt-4o-mini' });
    expect(await screen.findByDisplayValue('gpt-4o-mini')).toBeTruthy();
    expect(store.getState().chats.some((item) => item.id === chat.id)).toBe(true);
  });

  it('shows Switching model… while the model save is in flight', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if ((init?.method ?? 'GET') === 'PATCH') {
        return pending;
      }
      if (target.includes('/connections')) {
        return jsonResponse(200, [openaiConnection]);
      }
      return jsonResponse(200, [ai]);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    const model = (await screen.findByLabelText('Model')) as HTMLInputElement;
    fireEvent.change(model, { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Switching model…' })).toBeTruthy(),
    );
    release(jsonResponse(200, { ...ai, model: 'gpt-4o-mini' }));
    expect(await screen.findByDisplayValue('gpt-4o-mini')).toBeTruthy();
  });

  it('keeps the old values when the model switch fails', async () => {
    mockPanelFetch([openaiConnection], undefined, {
      status: 502,
      message: 'The AI could not be updated',
    });

    renderPanel();
    const model = (await screen.findByLabelText('Model')) as HTMLInputElement;
    fireEvent.change(model, { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        "The server couldn't finish. Nothing was left half-created; try again.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4o'),
    );
  });

  it('resets the model to the new provider default and sends both', async () => {
    const fetchMock = mockPanelFetch([openaiConnection, anthropicConnection], {
      ...ai,
      providerConnectionId: 'c-2',
      model: 'claude-opus-5-5',
    });

    renderPanel();
    await screen.findByDisplayValue('gpt-4o');

    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));

    const model = screen.getByLabelText('Model') as HTMLInputElement;
    await waitFor(() => expect(model.value).toBe('claude-opus-5-5'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchesTo(fetchMock)).toHaveLength(1));
    expect(bodyOf(patchesTo(fetchMock)[0]!)).toEqual({
      model: 'claude-opus-5-5',
      providerConnectionId: 'c-2',
    });
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
