import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { createChatStore } from '@/store/store';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { renderApp } from '@/test/renderApp';
import { ApprovalsPage } from '@/routes/ApprovalsPage';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

interface ApprovalFixture {
  id: string;
  aiId: string;
  groupId: string;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
  requestedBy: string;
  status: 'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
}

function makeApproval(
  overrides: Partial<{
    id: string;
    action: string;
    summary: string;
    details: string | null;
    worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
    expiresAt: string;
    createdAt: string;
  }> = {},
): ApprovalFixture {
  const id = overrides.id ?? 'apr-1';
  const action = overrides.action ?? 'merge_pull_request';
  return {
    id,
    aiId: 'ai-dev',
    groupId: 'dev-team',
    action,
    summary: overrides.summary ?? 'Merge PR #42',
    details:
      overrides.details === undefined ? 'Squash-merges the branch into main.' : overrides.details,
    argsHash: 'a'.repeat(64),
    worstCase:
      overrides.worstCase === undefined ? { currency: 'EUR', amount: 0.4 } : overrides.worstCase,
    requestedBy: 'dev-1@ai.zilar.test',
    status: 'pending',
    decidedAt: null,
    note: null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 12 * 60 * 1000).toISOString(),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

interface RouteSpec {
  method: string;
  path: string;
  respond: () => Response | Promise<Response>;
}

function fetchRouter(specs: RouteSpec[]): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const spec = specs.find((item) => item.method === method && item.path === url);
    if (spec === undefined) {
      return Promise.reject(new Error(`unexpected fetch ${method} ${url}`));
    }
    return Promise.resolve(spec.respond());
  });
}

function renderApprovalsPage() {
  const store = createChatStore({ chats: [] });
  const view = render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/settings/approvals']}>
          <Routes>
            <Route path="/settings/approvals" element={<ApprovalsPage />} />
            <Route path="/" element={<div>Home</div>} />
          </Routes>
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, view };
}

beforeEach(() => {
  // jsdom lacks matchMedia; the skeleton + media-query hook both reach for it.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ApprovalsPage', () => {
  it('renders inside the shared settings shell with the column class', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/approvals', respond: () => jsonResponse(200, []) },
      ]),
    );

    const { container } = renderApprovalsPage().view;

    expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeTruthy();
    expect(screen.getByText('Requests from your AIs that are waiting for you.')).toBeTruthy();
    expect(container.querySelector('.mx-auto.max-w-2xl')).not.toBeNull();
  });

  it('shows a loading skeleton then the list', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/approvals',
          respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
        },
      ]),
    );

    renderApprovalsPage();

    expect(await screen.findByText('merge_pull_request')).toBeTruthy();
    expect(screen.getByText('Merge PR #42')).toBeTruthy();
    expect(screen.getByText('Squash-merges the branch into main.')).toBeTruthy();
    expect(screen.getByText('Worst case: €0.40')).toBeTruthy();
    expect(screen.getByText(/expires in \d+ min/)).toBeTruthy();
  });

  it('shows the empty state with the muted icon when nothing is pending', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/approvals', respond: () => jsonResponse(200, []) },
      ]),
    );

    renderApprovalsPage();

    expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
  });

  it('keeps the manual Refresh button in the empty state and reloads on click', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/approvals',
          respond: () => {
            calls += 1;
            return jsonResponse(200, calls === 1 ? [] : [makeApproval({ id: 'apr-new' })]);
          },
        },
      ]),
    );

    renderApprovalsPage();

    await screen.findByText('Nothing is waiting for you.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('merge_pull_request')).toBeTruthy();
  });

  it('does not bring a decided request back when a stale list response arrives', async () => {
    let listCalls = 0;
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        // Every list still contains the request: it simulates a response that
        // was computed before the decision was committed.
        respond: () => {
          listCalls += 1;
          return jsonResponse(200, [makeApproval({ id: 'apr-1' })]);
        },
      },
      {
        method: 'POST',
        path: '/api/approvals/apr-1/decision',
        respond: () =>
          jsonResponse(200, { ...makeApproval({ id: 'apr-1' }), status: 'approved_once' }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve merge_pull_request' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve merge_pull_request' })).toBeNull(),
    );
    const before = listCalls;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
    expect(screen.queryByRole('button', { name: 'Approve merge_pull_request' })).toBeNull();
  });

  it('shows an error with a Retry button when listing fails', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/approvals',
          respond: () => jsonResponse(500, { error: { code: 'boom', message: 'server down' } }),
        },
      ]),
    );

    renderApprovalsPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('server down');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('retries loading when the Retry button is clicked', async () => {
    let attempts = 0;
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        respond: () => {
          attempts += 1;
          if (attempts === 1) {
            return jsonResponse(500, { error: { code: 'boom', message: 'server down' } });
          }
          return jsonResponse(200, [makeApproval({ id: 'apr-1' })]);
        },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('merge_pull_request')).toBeTruthy();
  });

  it('approve calls decideApproval(approve_once) and removes the row', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
      },
      {
        method: 'POST',
        path: '/api/approvals/apr-1/decision',
        respond: () =>
          jsonResponse(200, {
            ...makeApproval({ id: 'apr-1' }),
            status: 'approved_once',
            decidedAt: new Date().toISOString(),
          }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    const approve = await screen.findByRole('button', { name: 'Approve merge_pull_request' });
    fireEvent.click(approve);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            (call[1] as RequestInit)?.method === 'POST' &&
            String(call[0]) === '/api/approvals/apr-1/decision',
        ),
      ).toBe(true),
    );

    const [, init] = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit)?.method === 'POST' &&
        String(call[0]) === '/api/approvals/apr-1/decision',
    ) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approve_once' });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve merge_pull_request' })).toBeNull(),
    );
  });

  it('deny calls decideApproval(deny) and removes the row', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
      },
      {
        method: 'POST',
        path: '/api/approvals/apr-1/decision',
        respond: () =>
          jsonResponse(200, {
            ...makeApproval({ id: 'apr-1' }),
            status: 'denied',
            decidedAt: new Date().toISOString(),
          }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Deny merge_pull_request' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            (call[1] as RequestInit)?.method === 'POST' &&
            String(call[0]) === '/api/approvals/apr-1/decision',
        ),
      ).toBe(true),
    );

    const [, init] = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit)?.method === 'POST' &&
        String(call[0]) === '/api/approvals/apr-1/decision',
    ) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'deny' });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Deny merge_pull_request' })).toBeNull(),
    );
  });

  it('disables both buttons while a decision is in flight, so a double click does not double submit', async () => {
    let resolveDecision: (response: Response) => void = () => undefined;
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
      },
      {
        method: 'POST',
        path: '/api/approvals/apr-1/decision',
        respond: () =>
          new Promise<Response>((resolve) => {
            resolveDecision = resolve;
          }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    const approve = (await screen.findByRole('button', {
      name: 'Approve merge_pull_request',
    })) as HTMLButtonElement;
    fireEvent.click(approve);

    // While the decision request is in flight, both buttons must be disabled
    // so a second click cannot enqueue another POST.
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Approve merge_pull_request' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (screen.getByRole('button', { name: 'Deny merge_pull_request' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    // A second click on Approve while the request is in flight must not enqueue another POST.
    fireEvent.click(screen.getByRole('button', { name: 'Approve merge_pull_request' }));

    await act(async () => {
      resolveDecision(
        jsonResponse(200, {
          ...makeApproval({ id: 'apr-1' }),
          status: 'approved_once',
          decidedAt: new Date().toISOString(),
        }),
      );
    });

    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('a 409 not_pending removes the row and shows the stale notice', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
      },
      {
        method: 'POST',
        path: '/api/approvals/apr-1/decision',
        respond: () => errorResponse(409, 'not_pending', 'already decided'),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve merge_pull_request' }));

    await waitFor(() =>
      expect(screen.getByText('That request was already decided or expired.')).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Approve merge_pull_request' })).toBeNull();
  });

  it('a non-409 error leaves the row and shows the message inline', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/approvals',
        respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
      },
      {
        method: 'POST',
        path: '/api/approvals/apr-1/decision',
        respond: () => jsonResponse(500, { error: { code: 'boom', message: 'Could not send' } }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderApprovalsPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve merge_pull_request' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not send');
    expect(screen.getByRole('button', { name: 'Approve merge_pull_request' })).toBeTruthy();
  });

  it('refreshes the list every 30 seconds with fake timers and cleans up on unmount', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount += 1;
      return Promise.resolve(jsonResponse(200, [makeApproval({ id: 'apr-1' })]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { view } = renderApprovalsPage();

    // The initial load fetches once on mount.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance 30 s: the page's setInterval should fire another listApprovals().
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const before = fetchMock.mock.calls.length;

    // Unmount: the setInterval must be cleared, so further timer advances
    // never call the API again.
    view.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(before);
  }, 20_000);

  it('does not offer an "always allow" action in the inbox', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/approvals',
          respond: () => jsonResponse(200, [makeApproval({ id: 'apr-1' })]),
        },
      ]),
    );

    renderApprovalsPage();

    await screen.findByRole('button', { name: 'Approve merge_pull_request' });

    expect(screen.queryByRole('button', { name: /always/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /always allow/i })).toBeNull();
  });

  it('navigates back to the chat list with the Back button', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/approvals',
          respond: () => jsonResponse(200, []),
        },
      ]),
    );

    renderApprovalsPage();

    await screen.findByText('Nothing is waiting for you.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Home')).toBeTruthy();
  });
});

describe('Approvals menu item', () => {
  it('navigates from the chat list menu to the Approvals page', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/approvals',
          respond: () => jsonResponse(200, []),
        },
      ]),
    );

    renderApp('/');

    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approvals' }));

    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeTruthy();
    expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
  });

  it('two different rows can be decided at once; a second click on the same row sends once', async () => {
    const decided: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if ((init?.method ?? 'GET') === 'GET') {
          return Promise.resolve(
            jsonResponse(200, [
              makeApproval({ id: 'apr-1' }),
              makeApproval({ id: 'apr-2', action: 'deploy_site' }),
            ]),
          );
        }
        decided.push(url);
        // The decisions never answer: the test only counts the requests sent.
        return new Promise<Response>(() => undefined);
      }),
    );

    renderApprovalsPage();

    const first = await screen.findByRole('button', { name: 'Approve merge_pull_request' });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: 'Approve deploy_site' }));
    fireEvent.click(first);

    await waitFor(() => expect(decided).toHaveLength(2));
    expect(decided).toEqual(['/api/approvals/apr-1/decision', '/api/approvals/apr-2/decision']);
  });

  it('the decision notice stays for 3 seconds and then goes away', async () => {
    vi.useFakeTimers();
    const approval = makeApproval({ id: 'apr-1' });
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/approvals', respond: () => jsonResponse(200, [approval]) },
        {
          method: 'POST',
          path: '/api/approvals/apr-1/decision',
          respond: () =>
            jsonResponse(200, { ...approval, status: 'approved_once', decidedAt: null }),
        },
      ]),
    );

    renderApprovalsPage();

    await flushFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Approve merge_pull_request' }));
    await flushFakeTimers();

    const notice = 'Approved “merge_pull_request”.';
    expect(screen.getByText(notice)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_900);
    });
    expect(screen.queryByText(notice)).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByText(notice)).toBeNull();
  });

  it('the expires-in countdown moves once a minute', async () => {
    vi.useFakeTimers();
    // Ten and a half minutes left at mount: the 30 s refresh moves nothing
    // (still "in 11 min"), the 60 s tick moves it to "in 10 min".
    const approval = makeApproval({
      id: 'apr-1',
      expiresAt: new Date(Date.now() + 11 * 60_000 + 30_000).toISOString(),
    });
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        { method: 'GET', path: '/api/approvals', respond: () => jsonResponse(200, [approval]) },
      ]),
    );

    renderApprovalsPage();

    await flushFakeTimers();
    expect(screen.getByText('expires in 11 min')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(screen.getByText('expires in 11 min')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText('expires in 10 min')).toBeTruthy();
  });
});

/** Lets queued fetches and Effect steps run without moving the fake clock. */
async function flushFakeTimers(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}
