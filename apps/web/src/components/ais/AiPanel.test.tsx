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
});
