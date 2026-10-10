import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { AlwaysAllowedList, scopeTextFor } from './AlwaysAllowedList';
import type { ApprovalRule } from '@/lib/api';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const auth: AuthState = {
  status: 'authenticated',
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

function ruleFixture(overrides: Partial<ApprovalRule> = {}): ApprovalRule {
  return {
    id: 'rule-1',
    action: 'merge_pull_request',
    scope: 'personal',
    groupId: null,
    createdAt: '2026-09-29T10:00:00.000Z',
    createdBy: 'u-you',
    ...overrides,
  };
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

function renderList(scope: { aiId: string } | { groupId: string }) {
  const store = createChatStore({});
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <AlwaysAllowedList scope={scope} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlwaysAllowedList', () => {
  it('loads the AI rules once and shows the action with Personal chat', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/ais/a-1/approval-rules')) {
        return jsonResponse(200, [ruleFixture()]);
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });

    expect(await screen.findByText('merge_pull_request')).toBeTruthy();
    expect(screen.getByText('Personal chat')).toBeTruthy();

    const calls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('approval-rules'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toBe('/api/ais/a-1/approval-rules');
  });

  it('shows the group title when the store knows the group, else plain words', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    // The mock store knows the dev-team group id (g-devteam → Dev team).
    expect(
      scopeTextFor(
        ruleFixture({ id: 'r-g', scope: 'group', groupId: 'g-devteam' }),
        createChatStore({}).getState().groupInfos,
      ),
    ).toBe('In Dev team');
    expect(
      scopeTextFor(
        ruleFixture({ id: 'r-x', scope: 'group', groupId: 'g-unknown' }),
        createChatStore({}).getState().groupInfos,
      ),
    ).toBe('In a group');
  });

  it('renders a group rule row with the resolved title', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/groups/g-devteam/approval-rules')) {
        return jsonResponse(200, [
          ruleFixture({ id: 'r-g', scope: 'group', groupId: 'g-devteam' }),
        ]);
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ groupId: 'g-devteam' });

    expect(await screen.findByText('In Dev team')).toBeTruthy();
    const calls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('approval-rules'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toBe('/api/groups/g-devteam/approval-rules');
  });

  it('shows the empty copy when no rule exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, [])),
    );

    renderList({ aiId: 'a-1' });

    expect(await screen.findByText('Nothing is always allowed here.')).toBeTruthy();
  });

  it('shows an error with Retry on a failed load, and Retry loads again', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return errorResponse(500, 'server_error', 'rules unavailable');
      }
      return jsonResponse(200, [ruleFixture()]);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });

    expect(await screen.findByText('rules unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('merge_pull_request')).toBeTruthy();
  });

  it('Revoke asks for confirmation; Cancel keeps the row without a request', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/ais/a-1/approval-rules')) {
        return jsonResponse(200, [ruleFixture()]);
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke merge_pull_request' }));

    expect(screen.getByText('Stop always allowing merge_pull_request?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('merge_pull_request')).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toHaveLength(0);
  });

  it('confirming Revoke DELETEs and removes the row', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/ais/a-1/approval-rules')) {
        return jsonResponse(200, [ruleFixture()]);
      }
      if (target === '/api/approval-rules/rule-1' && init?.method === 'DELETE') {
        return jsonResponse(204, null);
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke merge_pull_request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoking merge_pull_request' }));

    await waitFor(() => expect(screen.queryByText('merge_pull_request')).toBeNull());
    const deletes = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0]?.[0])).toBe('/api/approval-rules/rule-1');
  });

  it('a 404 on revoke removes the row quietly', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/ais/a-1/approval-rules')) {
        return jsonResponse(200, [ruleFixture()]);
      }
      if (target === '/api/approval-rules/rule-1' && init?.method === 'DELETE') {
        return errorResponse(404, 'not_found', 'Approval rule not found');
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke merge_pull_request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoking merge_pull_request' }));

    await waitFor(() => expect(screen.queryByText('merge_pull_request')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed revoke keeps the row and shows an inline error', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/ais/a-1/approval-rules')) {
        return jsonResponse(200, [ruleFixture()]);
      }
      if (target === '/api/approval-rules/rule-1' && init?.method === 'DELETE') {
        return errorResponse(500, 'server_error', 'could not revoke');
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke merge_pull_request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoking merge_pull_request' }));

    expect(await screen.findByText('could not revoke')).toBeTruthy();
    expect(screen.getByText('merge_pull_request')).toBeTruthy();
  });

  it('disables the Revoke buttons while a revoke is in flight', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/ais/a-1/approval-rules')) {
        return jsonResponse(200, [
          ruleFixture(),
          ruleFixture({ id: 'rule-2', action: 'send_message' }),
        ]);
      }
      if (target.startsWith('/api/approval-rules/') && init?.method === 'DELETE') {
        return pending;
      }
      return errorResponse(404, 'not_found', 'unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList({ aiId: 'a-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke merge_pull_request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoking merge_pull_request' }));

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Revoke send_message' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    release(jsonResponse(204, null));
    await waitFor(() => expect(screen.queryByText('merge_pull_request')).toBeNull());
  });
});
