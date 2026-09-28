import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { AisPage } from '@/routes/AisPage';
import { createChatStore } from '@/store/store';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';

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

const activeConnection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const createdAi = {
  id: 'a-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'You are a concise senior engineer.',
  model: 'gpt-4o',
  jid: 'ai-a-1@galena.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  usage: { todayUsd: 0.5, windowUsd: 5 },
  createdAt: '2026-09-28T00:00:00.000Z',
};

interface RouteSpec {
  method: string;
  path: string;
  respond: () => Response;
}

function fetchRouter(specs: RouteSpec[]) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const spec = specs.find((item) => item.method === method && item.path === url);
    if (spec === undefined) {
      return Promise.reject(new Error(`unexpected fetch ${method} ${url}`));
    }
    return Promise.resolve(spec.respond());
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div>Chat screen {location.search}</div>;
}

function renderAisPage() {
  const store = createChatStore({ chats: [] });
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/settings/ais']}>
          <Routes>
            <Route path="/settings/ais" element={<AisPage />} />
            <Route path="/" element={<div>Chat list</div>} />
            <Route path="/c/:chatJid" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AisPage', () => {
  it('shows loading first, then the list', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/ais', respond: () => jsonResponse(200, [createdAi]) },
        {
          method: 'GET',
          path: '/api/connections',
          respond: () => jsonResponse(200, [activeConnection]),
        },
      ]),
    );

    renderAisPage();

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByText('Dev-1')).toBeTruthy();
    expect(screen.getByText('$2/day · $20/month')).toBeTruthy();
  });

  it("shows today's spend in mono under the model name", async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/ais', respond: () => jsonResponse(200, [createdAi]) },
        {
          method: 'GET',
          path: '/api/connections',
          respond: () => jsonResponse(200, [activeConnection]),
        },
      ]),
    );

    renderAisPage();

    const spend = await screen.findByText('Today $0.50');
    expect(spend.className).toContain('font-mono');
  });

  it('hides the spend line when usage is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/ais',
          respond: () => jsonResponse(200, [{ ...createdAi, usage: null }]),
        },
        {
          method: 'GET',
          path: '/api/connections',
          respond: () => jsonResponse(200, [activeConnection]),
        },
      ]),
    );

    renderAisPage();

    expect(await screen.findByText('Dev-1')).toBeTruthy();
    expect(screen.queryByText(/Today \$/)).toBeNull();
  });

  it('shows the empty state with a Create call to action', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([{ method: 'GET', path: '/api/ais', respond: () => jsonResponse(200, []) }]),
    );

    renderAisPage();

    expect(await screen.findByText(/You have no AIs yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create an AI' })).toBeTruthy();
  });

  it('shows the server message on an error', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/ais',
          respond: () => jsonResponse(500, { error: { code: 'boom', message: 'nope' } }),
        },
      ]),
    );
    renderAisPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('nope');
  });

  it('shows the ais_unavailable state', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/ais',
          respond: () => jsonResponse(503, { error: { code: 'ais_unavailable', message: 'nope' } }),
        },
      ]),
    );
    renderAisPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      "AI management isn't configured on this server.",
    );
  });

  it('opens the New AI dialog from Create AI', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/ais', respond: () => jsonResponse(200, [createdAi]) },
        {
          method: 'GET',
          path: '/api/connections',
          respond: () => jsonResponse(200, [activeConnection]),
        },
      ]),
    );

    renderAisPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create AI' }));

    expect(await screen.findByRole('dialog', { name: 'New AI' })).toBeTruthy();
    expect(await screen.findByLabelText('Name')).toBeTruthy();
  });

  it('opens the chat with the AI panel from Edit', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/ais', respond: () => jsonResponse(200, [createdAi]) },
        {
          method: 'GET',
          path: '/api/connections',
          respond: () => jsonResponse(200, [activeConnection]),
        },
      ]),
    );

    renderAisPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Dev-1' }));

    expect(await screen.findByText('Chat screen ?panel=ai')).toBeTruthy();
  });

  it('needs a confirm with the new wording before deleting', async () => {
    const fetchMock = fetchRouter([
      { method: 'GET', path: '/api/ais', respond: () => jsonResponse(200, [createdAi]) },
      {
        method: 'GET',
        path: '/api/connections',
        respond: () => jsonResponse(200, [activeConnection]),
      },
      { method: 'DELETE', path: '/api/ais/a-1', respond: () => jsonResponse(204, null) },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderAisPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Dev-1' }));

    expect(
      screen.getByText('This removes the AI and its chat. Your provider connection stays.'),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'DELETE')).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Dev-1' })).toBeNull());
    expect(await screen.findByText(/You have no AIs yet/)).toBeTruthy();
  });
});
