import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
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
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'ai-a-1@zilar.test',
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
  jid: 'ai-a-1@zilar.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  usage: { todayUsd: 0.5, windowUsd: 5 },
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
// from `patch` (a body) or fail with `patchError`. A GET for one AI answers
// `refetched`, the server truth after a partial save. `listed` is the AI the
// list answers, so usage states render per test.
function mockPanelFetch(
  connections: unknown[] = [openaiConnection],
  patch: unknown = { ...ai },
  patchError?: { status: number; message: string },
  refetched: unknown = { ...ai },
  listed: unknown = ai,
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
    if (/\/ais\/[^/]+$/.test(target)) {
      return jsonResponse(200, refetched);
    }
    if (target.includes('/audit')) {
      return jsonResponse(200, { entries: [], next: null });
    }
    // T-0100: the rules section loads alongside the panel; the default
    // is an empty list so tests about other sections stay quiet.
    if (target.includes('/approval-rules')) {
      return jsonResponse(200, []);
    }
    return jsonResponse(200, [listed]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// T-0080: a richer mock for the kill-switch panel tests. `state` is the
// server's view of the AI; `stop` and `resume` answers are produced from
// it (stop flips status to `stopped`, resume back to `active`); the AI
// list endpoint always answers `[state]`. PATCH/DELETE keep the same
// shape as `mockPanelFetch` for symmetry.
function mockPanelFetchWithState(
  initial: Record<string, unknown>,
  options: {
    connections?: unknown[];
    patch?: unknown;
    patchError?: { status: number; message: string };
    /** When set, /ais/:id/stop returns 503 (gateway not configured). */
    stopError?: { status: number; message: string };
    /** When set, /ais/:id/resume returns 503 (gateway not configured). */
    resumeError?: { status: number; message: string };
  } = {},
): { fetchMock: ReturnType<typeof vi.fn>; getState: () => Record<string, unknown> } {
  let state = { ...initial };
  const getState = (): Record<string, unknown> => state;
  const connections = options.connections ?? [openaiConnection];
  const patch = options.patch ?? state;
  const patchError = options.patchError;
  const stopError = options.stopError;
  const resumeError = options.resumeError;
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PATCH' && /\/ais\/[^/]+$/.test(target)) {
      if (patchError !== undefined) {
        return jsonResponse(patchError.status, {
          error: { code: 'ai_update_failed', message: patchError.message },
        });
      }
      state = { ...state, ...(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>) };
      return jsonResponse(200, state);
    }
    if (method === 'POST' && target.endsWith('/stop')) {
      if (stopError !== undefined) {
        // Mirrors the real error shape: a 502 from the gateway becomes a
        // `not_active`-or-similar code; the panel's `describeAiError` only
        // recognises a fixed set, so the test exercises one of them.
        return jsonResponse(stopError.status, {
          error: { code: 'ai_update_failed', message: stopError.message },
        });
      }
      state = { ...state, status: 'stopped' };
      return jsonResponse(200, state);
    }
    if (method === 'POST' && target.endsWith('/resume')) {
      if (resumeError !== undefined) {
        return jsonResponse(resumeError.status, {
          error: { code: 'ai_update_failed', message: resumeError.message },
        });
      }
      state = { ...state, status: 'active' };
      return jsonResponse(200, state);
    }
    if (target.includes('/connections')) {
      return jsonResponse(200, connections);
    }
    if (method === 'DELETE') {
      return jsonResponse(204, null);
    }
    if (target.includes('/approval-rules')) {
      return jsonResponse(200, []);
    }
    if (target.includes('/audit')) {
      return jsonResponse(200, { entries: [], next: null });
    }
    if (/\/ais\/[^/]+$/.test(target) && method === 'GET') {
      return jsonResponse(200, patch);
    }
    return jsonResponse(200, [state]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, getState };
}

function renderPanel() {
  const store = createChatStore({ chats: [chat] });
  const onClose = vi.fn();
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/c/ai-a-1@zilar.test']}>
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

  it('shows the AI picture when the server sends one', async () => {
    const pictured = { ...ai, avatarUrl: '/api/avatars/a-1' };
    mockPanelFetch([openaiConnection], pictured, undefined, pictured, pictured);

    renderPanel();

    expect(await screen.findByDisplayValue('Dev-1')).toBeTruthy();
    expect(document.querySelector('header img[src="/api/avatars/a-1"]')).not.toBeNull();
  });

  it('shows the usage block with meters above the limits', async () => {
    mockPanelFetch();

    renderPanel();

    expect(await screen.findByText('Today $0.50 of $2.00')).toBeTruthy();
    expect(screen.getByText('30-day window $5.00 of $20.00')).toBeTruthy();
    expect(
      screen.getByText(
        'Spend updates within a minute or two; the daily limit may let a last reply through.',
      ),
    ).toBeTruthy();

    const today = screen.getByRole('progressbar', { name: "Today's spend" });
    expect(today.getAttribute('aria-valuenow')).toBe('25');
    const fill = today.firstElementChild as HTMLElement | null;
    expect(fill?.style.width).toBe('25%');
    expect(fill?.className).not.toContain('bg-danger');

    // The usage block sits above the per-day/per-month fields.
    const usageHeading = screen.getByText('Usage');
    const dayField = screen.getByLabelText('Per day amount');
    expect(usageHeading.compareDocumentPosition(dayField)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('turns the meters danger at or above 100%', async () => {
    const over = { ...ai, usage: { todayUsd: 2, windowUsd: 25 } };
    mockPanelFetch([openaiConnection], over, undefined, over, over);

    renderPanel();

    expect(await screen.findByText('Today $2.00 of $2.00')).toBeTruthy();
    expect(screen.getByText('30-day window $25.00 of $20.00')).toBeTruthy();
    for (const name of ["Today's spend", '30-day window spend']) {
      const meter = screen.getByRole('progressbar', { name });
      expect(meter.getAttribute('aria-valuenow')).toBe('100');
      expect(meter.firstElementChild?.className).toContain('bg-danger');
    }
  });

  it('shows usage unavailable when the server has no spend', async () => {
    const none = { ...ai, usage: null };
    mockPanelFetch([openaiConnection], none, undefined, none, none);

    renderPanel();

    expect(await screen.findByText('Usage unavailable')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
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
          <MemoryRouter initialEntries={['/c/ai-a-1@zilar.test']}>
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
      if (target.includes('/approval-rules')) {
        return jsonResponse(200, []);
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

  it('shows the server truth after a partial save failure', async () => {
    // The swap committed the model but the later rename failed: the server
    // has the new model with the old name.
    const fetchMock = mockPanelFetch(
      [openaiConnection],
      undefined,
      { status: 502, message: 'The AI could not be updated' },
      { ...ai, model: 'gpt-4o-mini' },
    );

    renderPanel();
    const model = (await screen.findByLabelText('Model')) as HTMLInputElement;
    fireEvent.change(model, { target: { value: 'gpt-4o-mini' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        "The server couldn't finish. Nothing was left half-created; try again.",
      ),
    ).toBeTruthy();
    // The refetch ran and its values — not the stale snapshot — are shown.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/ais/a-1'))).toBe(true),
    );
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4o-mini');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dev-1');
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

  // T-0080: the owner kill switch. The panel renders a "Stop AI" button
  // with a confirm step for an active AI, and a "Stopped" label plus a
  // "Resume" button for a stopped AI. While the call is in flight the
  // button is disabled; errors show inline like the other panel actions.
  describe('kill switch (T-0080)', () => {
    it('shows a Stop AI button with a confirm step for an active AI', async () => {
      mockPanelFetchWithState({ ...ai, status: 'active' });
      renderPanel();
      await screen.findByDisplayValue('Dev-1');

      // First tap arms the destructive action.
      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));
      expect(
        screen.getByText(/Stop Dev-1\? It goes offline at once and any reply in flight is dropped/),
      ).toBeTruthy();
    });

    it('the second tap POSTs /ais/:id/stop and shows the new status on success', async () => {
      const { fetchMock, getState } = mockPanelFetchWithState({ ...ai, status: 'active' });
      renderPanel();
      await screen.findByDisplayValue('Dev-1');

      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));
      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));

      // The fetch fired for /stop and answered with the stopped AI.
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(
            (call) =>
              String(call[0]).endsWith('/ais/a-1/stop') &&
              ((call[1] as RequestInit)?.method ?? 'GET') === 'POST',
          ),
        ).toBe(true),
      );
      expect(getState().status).toBe('stopped');
      // The Stop AI button is gone; the Stopped label and Resume button
      // appear instead.
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop AI' })).toBeNull());
      expect(screen.getByText('Stopped')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    });

    it('disables the Stop AI button while the call is in flight', async () => {
      let release!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target.includes('/connections')) return jsonResponse(200, [openaiConnection]);
        if (target.endsWith('/stop')) return pending;
        if (target.endsWith('/resume')) return jsonResponse(200, { ...ai, status: 'active' });
        if ((init?.method ?? 'GET') === 'DELETE') return jsonResponse(204, null);
        if (/\/ais\/[^/]+$/.test(target)) return jsonResponse(200, ai);
        if (target.includes('/approval-rules')) return jsonResponse(200, []);
        return jsonResponse(200, [ai]);
      });
      vi.stubGlobal('fetch', fetchMock);

      renderPanel();
      await screen.findByDisplayValue('Dev-1');

      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));
      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Stopping…' })).toBeTruthy());
      expect(
        (screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled,
      ).toBe(true);

      release(jsonResponse(200, { ...ai, status: 'stopped' }));
      expect(await screen.findByText('Stopped')).toBeTruthy();
    });

    it('shows an inline error and keeps the active state when stop fails', async () => {
      const { fetchMock } = mockPanelFetchWithState(
        { ...ai, status: 'active' },
        {
          stopError: { status: 502, message: 'Could not stop the AI' },
        },
      );
      renderPanel();
      await screen.findByDisplayValue('Dev-1');

      // First click arms the destructive action; the confirm copy appears.
      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));
      // Second click confirms — the network call fails and the inline
      // error lands above the buttons, while the confirm step resets.
      fireEvent.click(screen.getByRole('button', { name: 'Stop AI' }));

      // The fetch fired for /stop and answered with the error.
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(
            (call) =>
              String(call[0]).endsWith('/ais/a-1/stop') &&
              ((call[1] as RequestInit)?.method ?? 'GET') === 'POST',
          ),
        ).toBe(true),
      );
      // The AI stays active (no Stopped label) and the inline error lands
      // above the buttons. The Stop AI button reappears (confirm resets).
      await waitFor(() => expect(screen.queryByText('Stopped')).toBeNull());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Stop AI' })).toBeTruthy());
      expect(
        screen.getByText("The server couldn't finish. Nothing was left half-created; try again."),
      ).toBeTruthy();
    });

    it('for a stopped AI, renders the Stopped label and a Resume button that POSTs /resume', async () => {
      const { fetchMock } = mockPanelFetchWithState({ ...ai, status: 'stopped' });
      renderPanel();
      // The label appears in the header at first paint.
      expect(await screen.findByText('Stopped')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(
            (call) =>
              String(call[0]).endsWith('/ais/a-1/resume') &&
              ((call[1] as RequestInit)?.method ?? 'GET') === 'POST',
          ),
        ).toBe(true),
      );
      // After the server answers, the panel re-renders against the new
      // status (active): the Stop AI button reappears, Stopped label is
      // gone.
      await waitFor(() => expect(screen.queryByText('Stopped')).toBeNull());
      expect(screen.getByRole('button', { name: 'Stop AI' })).toBeTruthy();
    });

    it('keeps the stopped state and shows an inline error when resume fails', async () => {
      mockPanelFetchWithState(
        { ...ai, status: 'stopped' },
        {
          resumeError: { status: 502, message: 'Could not resume the AI' },
        },
      );
      renderPanel();
      expect(await screen.findByText('Stopped')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      expect(
        await screen.findByText(
          "The server couldn't finish. Nothing was left half-created; try again.",
        ),
      ).toBeTruthy();
      // The AI is still stopped.
      expect(screen.getByText('Stopped')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    });
  });

  describe('activity section (T-0084)', () => {
    it('renders the Activity heading at the bottom of the panel', async () => {
      mockPanelFetch();
      renderPanel();

      expect(await screen.findByRole('heading', { name: 'Activity' })).toBeTruthy();
    });

    it('shows a Stopped entry from the audit list', async () => {
      const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if ((init?.method ?? 'GET') === 'PATCH') {
          return jsonResponse(200, ai);
        }
        if (target.includes('/connections')) {
          return jsonResponse(200, [openaiConnection]);
        }
        if (/\/ais\/[^/]+$/.test(target)) {
          return jsonResponse(200, ai);
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, []);
        }
        if (target.includes('/audit')) {
          return jsonResponse(200, {
            entries: [
              {
                id: 'audit-1',
                at: new Date(Date.now() - 3 * 60_000).toISOString(),
                aiId: 'a-1',
                groupId: null,
                action: 'ai.stopped',
                subjectId: 'a-1',
                argsHash: null,
                cost: null,
                result: 'ok',
                detail: null,
                actorUserId: 'u-you',
              },
            ],
            next: null,
          });
        }
        return jsonResponse(200, [ai]);
      });
      vi.stubGlobal('fetch', fetchMock);

      renderPanel();

      expect(await screen.findByText('Stopped')).toBeTruthy();
      expect(screen.getByDisplayValue('Dev-1')).toBeTruthy();
    });

    it('a 404 on the audit endpoint leaves the rest of the panel intact', async () => {
      const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if ((init?.method ?? 'GET') === 'PATCH') {
          return jsonResponse(200, ai);
        }
        if (target.includes('/connections')) {
          return jsonResponse(200, [openaiConnection]);
        }
        if (/\/ais\/[^/]+$/.test(target)) {
          return jsonResponse(200, ai);
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, []);
        }
        if (target.includes('/audit')) {
          return jsonResponse(404, {
            error: { code: 'not_found', message: 'AI not found' },
          });
        }
        return jsonResponse(200, [ai]);
      });
      vi.stubGlobal('fetch', fetchMock);

      renderPanel();

      await screen.findByRole('heading', { name: 'Activity' });
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Stop AI' })).toBeTruthy();
      expect(screen.getByDisplayValue('Dev-1')).toBeTruthy();
    });
  });

  // T-0100: the standing rules section. `listAis` only returns the
  // viewer's own AIs, so the panel (and its rules list) is owner-only by
  // construction: a stranger's AI lands on the missing state with no
  // section and no rules request.
  describe('always allowed section (T-0100)', () => {
    function mockPanelFetchWithRules(rules: unknown[]): ReturnType<typeof vi.fn> {
      const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if ((init?.method ?? 'GET') === 'PATCH') {
          return jsonResponse(200, ai);
        }
        if (target.includes('/connections')) {
          return jsonResponse(200, [openaiConnection]);
        }
        if (target.includes('/machines')) {
          return jsonResponse(200, []);
        }
        if (target.includes('/approval-rules')) {
          return jsonResponse(200, rules);
        }
        if (/\/ais\/[^/]+$/.test(target)) {
          return jsonResponse(200, ai);
        }
        if (target.includes('/audit')) {
          return jsonResponse(200, { entries: [], next: null });
        }
        return jsonResponse(200, [ai]);
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('renders the section for the owner and fetches the AI rules once', async () => {
      const fetchMock = mockPanelFetchWithRules([
        {
          id: 'rule-1',
          action: 'merge_pull_request',
          scope: 'personal',
          groupId: null,
          createdAt: '2026-09-29T10:00:00.000Z',
          createdBy: 'u-you',
        },
      ]);

      renderPanel();

      expect(await screen.findByRole('heading', { name: 'Always allowed' })).toBeTruthy();
      expect(await screen.findByText('merge_pull_request')).toBeTruthy();
      expect(screen.getByText('Personal chat')).toBeTruthy();

      const ruleCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/approval-rules'),
      );
      expect(ruleCalls).toHaveLength(1);
      expect(String(ruleCalls[0]?.[0])).toBe('/api/ais/a-1/approval-rules');
    });

    it('a stranger sees the missing state with no rules section and no rules request', async () => {
      const fetchMock = vi.fn(async (url: unknown) => {
        const target = String(url);
        if (target.includes('/connections')) {
          return jsonResponse(200, [openaiConnection]);
        }
        if (target.includes('/audit')) {
          return jsonResponse(200, { entries: [], next: null });
        }
        // The server's owner filter: someone else's AI is not listed.
        return jsonResponse(200, []);
      });
      vi.stubGlobal('fetch', fetchMock);

      renderPanel();

      expect(await screen.findByText('This AI no longer exists.')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Always allowed' })).toBeNull();
      const ruleCalls = (fetchMock.mock.calls as unknown[][]).filter((call) =>
        String(call[0]).includes('/approval-rules'),
      );
      expect(ruleCalls).toHaveLength(0);
    });
  });
});

// T-0091: the "Runs on" select. It lists the owner's approved machines
// plus "The platform (no machine)", sends the PUT on change, rolls back
// and shows an inline error on failure, and stays disabled (current value
// only) when the machines load fails.
describe('AiPanel home machine (T-0091)', () => {
  const approvedMachine = {
    id: 'm-approved',
    name: 'julio-mbp',
    status: 'approved',
    os: 'macos',
    osVersion: '27.0',
    arch: 'arm64',
    cpu: 'Apple M3 Pro',
    cores: 11,
    ramGb: 18,
    diskFreeGb: 200,
    drivers: ['docker'],
    fingerprint: 'b2c3d4e5f607182a',
    createdAt: '2026-09-25T10:00:00.000Z',
    approvedAt: '2026-09-25T10:01:00.000Z',
    lastSeenAt: null,
    online: false,
  };

  const pendingMachine = {
    ...approvedMachine,
    id: 'm-pending',
    name: 'office-linux',
    status: 'pending',
    approvedAt: null,
  };

  const revokedMachine = {
    ...approvedMachine,
    id: 'm-revoked',
    name: 'old-macbook',
    status: 'revoked',
  };

  function aiWithMachine(machineId: string | null): Record<string, unknown> {
    return { ...ai, machineId: machineId };
  }

  function mockAiPanelFetchWithMachines(options: {
    machines: unknown[] | { fail: true };
    initialAi: Record<string, unknown>;
    assignResponse?: { status: number; body?: unknown };
  }): ReturnType<typeof vi.fn> {
    const { machines, initialAi, assignResponse } = options;
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT' && target.endsWith('/machine')) {
        if (assignResponse !== undefined) {
          return jsonResponse(assignResponse.status, assignResponse.body);
        }
        return jsonResponse(200, { ...initialAi, machineId: null });
      }
      if (target.endsWith('/machines') && method === 'GET') {
        if ('fail' in machines) {
          return jsonResponse(500, { error: { code: 'boom', message: 'server down' } });
        }
        return jsonResponse(200, machines);
      }
      if (target.includes('/connections')) {
        return jsonResponse(200, [openaiConnection]);
      }
      if (target.includes('/approval-rules')) {
        return jsonResponse(200, []);
      }
      if (target.includes('/audit')) {
        return jsonResponse(200, { entries: [], next: null });
      }
      if (/\/ais\/[^/]+$/.test(target) && method === 'GET') {
        return jsonResponse(200, initialAi);
      }
      if (method === 'DELETE') {
        return jsonResponse(204, null);
      }
      return jsonResponse(200, [initialAi]);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renders the select with approved machines and "The platform"', async () => {
    mockAiPanelFetchWithMachines({
      machines: [approvedMachine, pendingMachine, revokedMachine],
      initialAi: aiWithMachine(null),
    });

    renderPanel();

    const select = await screen.findByLabelText('Runs on');
    expect(select).toBeTruthy();
    const options = Array.from((select as HTMLSelectElement).options).map((option) => ({
      value: option.value,
      label: option.textContent,
    }));
    // Only the approved machine and "The platform" — pending and revoked
    // are filtered out.
    expect(options).toEqual([
      { value: '', label: 'The platform (no machine)' },
      { value: 'm-approved', label: 'julio-mbp' },
    ]);
  });

  it('puts the AI on the approved machine and the PUT body is the machine id', async () => {
    const fetchMock = mockAiPanelFetchWithMachines({
      machines: [approvedMachine],
      initialAi: aiWithMachine(null),
      assignResponse: { status: 200, body: aiWithMachine('m-approved') },
    });

    renderPanel();
    const select = (await screen.findByLabelText('Runs on')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'm-approved' } });

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (call) => methodOf(call) === 'PUT' && String(call[0]).endsWith('/ais/a-1/machine'),
      );
      expect(put).toBeDefined();
      expect(bodyOf(put!)).toEqual({ machineId: 'm-approved' });
    });
  });

  it('rolls back and shows an inline error when the PUT fails', async () => {
    const fetchMock = mockAiPanelFetchWithMachines({
      machines: [approvedMachine],
      initialAi: aiWithMachine(null),
      assignResponse: {
        status: 404,
        body: { error: { code: 'machine_not_found', message: 'Machine not found' } },
      },
    });

    renderPanel();
    const select = (await screen.findByLabelText('Runs on')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'm-approved' } });

    await waitFor(() => expect(screen.getByText('Machine not found')).toBeTruthy());
    // The PUT happened…
    const putCalls = fetchMock.mock.calls.filter(
      (call) => methodOf(call) === 'PUT' && String(call[0]).endsWith('/machine'),
    );
    expect(putCalls.length).toBeGreaterThan(0);
    // …and the select rolled back to "The platform".
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('disables the select with the current value only when the machines load fails', async () => {
    mockAiPanelFetchWithMachines({
      machines: { fail: true },
      initialAi: aiWithMachine('m-approved'),
    });

    renderPanel();

    const select = (await screen.findByLabelText('Runs on')) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(true));
    // The current value is still rendered so the owner sees what the AI is on.
    expect(select.value).toBe('m-approved');
    // No other options are offered.
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['m-approved']);
  });
});
