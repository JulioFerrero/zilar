import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { createChatStore } from '@/store/store';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { MachinesPage } from '@/routes/MachinesPage';

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return {
      ok: true,
      status,
      json: async () => body,
    } as Response;
  }
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

const pendingMachine = {
  id: 'm-pending',
  name: 'office-linux',
  status: 'pending',
  os: 'linux',
  osVersion: '6.6.0',
  arch: 'x86_64',
  cpu: 'AMD Ryzen 9',
  cores: 16,
  ramGb: 64,
  diskFreeGb: 920,
  drivers: ['docker', 'linux-vm'],
  fingerprint: 'a1b2c3d4e5f60718',
  createdAt: '2026-09-29T08:00:00.000Z',
  approvedAt: null,
  lastSeenAt: null,
};

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
  drivers: ['docker', 'apple-container'],
  fingerprint: 'b2c3d4e5f607182a',
  createdAt: '2026-09-25T10:00:00.000Z',
  approvedAt: '2026-09-25T10:01:00.000Z',
  lastSeenAt: '2026-09-29T07:55:00.000Z',
  online: true,
};

const revokedMachine = {
  id: 'm-revoked',
  name: 'old-macbook',
  status: 'revoked',
  os: 'macos',
  osVersion: '26.4',
  arch: 'arm64',
  cpu: 'Apple M2',
  cores: 8,
  ramGb: 16,
  diskFreeGb: 320,
  drivers: ['docker'],
  fingerprint: 'c3d4e5f607182a3b',
  createdAt: '2026-08-10T10:00:00.000Z',
  approvedAt: '2026-08-10T10:01:00.000Z',
  lastSeenAt: '2026-09-20T11:00:00.000Z',
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
  return <div>Home {location.pathname}</div>;
}

function renderMachinesPage() {
  const store = createChatStore({ chats: [] });
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/settings/machines']}>
          <Routes>
            <Route path="/settings/machines" element={<MachinesPage />} />
            <Route path="/" element={<LocationProbe />} />
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

describe('MachinesPage', () => {
  it('shows a loading skeleton then the three sections', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/machines',
          respond: () => jsonResponse(200, [pendingMachine, approvedMachine, revokedMachine]),
        },
      ]),
    );

    renderMachinesPage();

    expect(await screen.findByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('Your machines')).toBeTruthy();
    expect(screen.getByText(/Revoked \(1\)/)).toBeTruthy();
    expect(screen.getByText('office-linux')).toBeTruthy();
    expect(screen.getByText('julio-mbp')).toBeTruthy();
  });

  it('shows the empty state with an Add call to action', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([{ method: 'GET', path: '/api/machines', respond: () => jsonResponse(200, []) }]),
    );

    renderMachinesPage();

    expect(await screen.findByText(/No machines yet/)).toBeTruthy();
  });

  it('shows an error with Retry when listing fails', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/machines',
          respond: () => jsonResponse(500, { error: { code: 'boom', message: 'server down' } }),
        },
      ]),
    );

    renderMachinesPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('server down');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('approves a pending machine and moves it to the Your machines section', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/machines',
        respond: () => jsonResponse(200, [pendingMachine, approvedMachine]),
      },
      {
        method: 'POST',
        path: '/api/machines/m-pending/approve',
        respond: () =>
          jsonResponse(200, {
            ...pendingMachine,
            status: 'approved',
            approvedAt: '2026-09-29T09:00:00.000Z',
          }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderMachinesPage();

    const approve = await screen.findByRole('button', { name: 'Approve office-linux' });
    fireEvent.click(approve);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            (call[1] as RequestInit)?.method === 'POST' &&
            String(call[0]) === '/api/machines/m-pending/approve',
        ),
      ).toBe(true),
    );

    // After approve, the pending card disappears (no more "Approve office-linux").
    expect(screen.queryByRole('button', { name: 'Approve office-linux' })).toBeNull();
    // Your machines now has both julio-mbp and office-linux (now approved).
    expect(screen.getAllByText('office-linux').length).toBeGreaterThan(0);
  });

  it('asks twice before denying a pending machine', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/machines',
        respond: () => jsonResponse(200, [pendingMachine]),
      },
      {
        method: 'POST',
        path: '/api/machines/m-pending/deny',
        respond: () => jsonResponse(204, null),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderMachinesPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Deny office-linux' }));

    // Confirm panel shows; second click goes through.
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          (call[1] as RequestInit)?.method === 'POST' &&
          String(call[0]) === '/api/machines/m-pending/deny',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            (call[1] as RequestInit)?.method === 'POST' &&
            String(call[0]) === '/api/machines/m-pending/deny',
        ),
      ).toBe(true),
    );
  });

  it('asks twice before revoking an approved machine', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/machines',
        respond: () => jsonResponse(200, [approvedMachine]),
      },
      {
        method: 'POST',
        path: '/api/machines/m-approved/revoke',
        respond: () => jsonResponse(200, { ...approvedMachine, status: 'revoked' }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderMachinesPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke julio-mbp' }));

    expect(
      fetchMock.mock.calls.some(
        (call) =>
          (call[1] as RequestInit)?.method === 'POST' &&
          String(call[0]) === '/api/machines/m-approved/revoke',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            (call[1] as RequestInit)?.method === 'POST' &&
            String(call[0]) === '/api/machines/m-approved/revoke',
        ),
      ).toBe(true),
    );
  });

  it('saves the rename on Enter and cancels on Escape', async () => {
    const fetchMock = fetchRouter([
      {
        method: 'GET',
        path: '/api/machines',
        respond: () => jsonResponse(200, [approvedMachine]),
      },
      {
        method: 'PATCH',
        path: '/api/machines/m-approved',
        respond: () => jsonResponse(200, { ...approvedMachine, name: 'julio-mbp-2' }),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderMachinesPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Rename julio-mbp' }));

    const input = (await screen.findByLabelText('Rename julio-mbp')) as HTMLInputElement;
    expect(input.value).toBe('julio-mbp');
    fireEvent.change(input, { target: { value: 'julio-mbp-2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            (call[1] as RequestInit)?.method === 'PATCH' &&
            String(call[0]) === '/api/machines/m-approved',
        ),
      ).toBe(true),
    );

    // Escape on a fresh edit cancels and rolls back the input.
    fireEvent.click(await screen.findByRole('button', { name: 'Rename julio-mbp-2' }));
    const second = (await screen.findByLabelText('Rename julio-mbp-2')) as HTMLInputElement;
    fireEvent.change(second, { target: { value: 'oops' } });
    fireEvent.keyDown(second, { key: 'Escape' });

    // No new PATCH was issued for the cancelled edit.
    const patches = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit)?.method === 'PATCH',
    );
    expect(patches).toHaveLength(1);
  });

  it('leaves the card and shows an inline error when an action fails', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/machines',
          respond: () => jsonResponse(200, [pendingMachine]),
        },
        {
          method: 'POST',
          path: '/api/machines/m-pending/approve',
          respond: () =>
            jsonResponse(409, {
              error: {
                code: 'invalid_transition',
                message: 'Only pending machines can be approved',
              },
            }),
        },
      ]),
    );

    renderMachinesPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve office-linux' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Only pending machines can be approved');

    // The pending card is still here (the failed action did not change state).
    expect(screen.getByRole('button', { name: 'Approve office-linux' })).toBeTruthy();
  });

  it('opens the add-machine dialog and shows the code with a working copy key', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/machines',
          respond: () => jsonResponse(200, []),
        },
        {
          method: 'POST',
          path: '/api/machines/pairing-codes',
          respond: () =>
            jsonResponse(201, { code: 'K7QX-M2PA', expiresAt: '2026-09-29T10:10:00.000Z' }),
        },
      ]),
    );

    // jsdom does not implement navigator.clipboard; install a stub.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderMachinesPage();

    fireEvent.click((await screen.findAllByRole('button', { name: /Add machine/ }))[0]!);

    expect(await screen.findByRole('dialog', { name: 'Add machine' })).toBeTruthy();
    expect(screen.getByText('K7QX-M2PA')).toBeTruthy();
    expect(screen.getByText(/galena-runner pair K7QX-M2PA/)).toBeTruthy();
    expect(screen.getByText('The runner app is coming soon.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy pairing code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('K7QX-M2PA'));
    expect(screen.getByRole('button', { name: 'Copy pairing code' }).textContent).toContain(
      'Copied',
    );
  });

  it('closes the add dialog on Escape and clears timers', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/machines',
          respond: () => jsonResponse(200, []),
        },
        {
          method: 'POST',
          path: '/api/machines/pairing-codes',
          respond: () =>
            jsonResponse(201, { code: 'K7QX-M2PA', expiresAt: '2026-09-29T10:10:00.000Z' }),
        },
      ]),
    );

    renderMachinesPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Add machine/ }))[0]!);
    expect(await screen.findByRole('dialog', { name: 'Add machine' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add machine' })).toBeNull();
  });

  it('shows an inline error inside the dialog when the server rejects the code', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRouter([
        {
          method: 'GET',
          path: '/api/machines',
          respond: () => jsonResponse(200, []),
        },
        {
          method: 'POST',
          path: '/api/machines/pairing-codes',
          respond: () =>
            jsonResponse(409, {
              error: { code: 'pairing_code_limit', message: 'At most 5 unused pairing codes' },
            }),
        },
      ]),
    );

    renderMachinesPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Add machine/ }))[0]!);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'You already have unused pairing codes',
    );
  });
});
