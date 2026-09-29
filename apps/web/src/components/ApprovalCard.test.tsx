import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApprovalRequestSchema } from '@galena/protocol';
import { ApprovalCard } from './ApprovalCard';

const request = ApprovalRequestSchema.parse({
  id: 'apr-42',
  room: 'dev-team@rooms.galena.test',
  ai: 'dev-1@ai.galena.test',
  action: 'merge_pull_request',
  summary: 'Merge PR #42 — fix the checkout button on mobile Safari',
  details: 'Squash-merges the branch into main.',
  args_hash: 'a'.repeat(64),
  worst_case_cost: { currency: 'EUR', amount: 0.4 },
  requested_by: 'dev-1@ai.galena.test',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});

interface ApprovalFixture {
  id: string;
  status: 'pending' | 'approved_once' | 'denied' | 'consumed' | 'expired';
  expiresAt: string;
  action?: string;
}

function approvalFixture({
  id = 'apr-42',
  status = 'pending',
  expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
  action = 'merge_pull_request',
}: Partial<ApprovalFixture> = {}): unknown {
  return {
    id,
    aiId: 'ai-dev-1',
    groupId: 'dev-team',
    action,
    summary: 'Merge PR #42',
    details: null,
    argsHash: 'a'.repeat(64),
    worstCase: null,
    requestedBy: 'dev-1@ai.galena.test',
    status,
    decidedAt: status === 'pending' ? null : new Date().toISOString(),
    note: null,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function makeFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  });
}

beforeEach(() => {
  // jsdom lacks matchMedia; some shared components reach for it.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: () => undefined,
      removeListener: () => undefined,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ApprovalCard', () => {
  it('renders the request text while loading and shows Approve/Deny once the state arrives', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, approvalFixture()));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);

    expect(
      screen.getByText('Merge PR #42 — fix the checkout button on mobile Safari'),
    ).toBeTruthy();
    expect(screen.getByText('Worst case: €0.40')).toBeTruthy();

    const approve = await screen.findByRole('button', { name: 'Approve' });
    const deny = screen.getByRole('button', { name: 'Deny' });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    expect((deny as HTMLButtonElement).disabled).toBe(false);
  });

  it('Approve sends approve_once and shows Approved', async () => {
    let approval = approvalFixture();
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, approval));
      }
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ decision: 'approve_once' });
        approval = approvalFixture({ status: 'approved_once' });
        return Promise.resolve(jsonResponse(200, approval));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('Deny sends deny and shows Denied', async () => {
    let approval = approvalFixture();
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, approval));
      }
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ decision: 'deny' });
        approval = approvalFixture({ status: 'denied' });
        return Promise.resolve(jsonResponse(200, approval));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(await screen.findByText('Denied')).toBeTruthy();
  });

  it('a 404 hides the buttons with no error message', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(errorResponse(404, 'not_found', 'Approval not found'));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);

    expect(await screen.findByText('Waiting for a decision')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  it('an already-decided approval shows its status with no buttons', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, approvalFixture({ status: 'approved_once' })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);

    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('consumed shows "Already used" and expired shows "Expired"', async () => {
    const consumedFetch = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, approvalFixture({ status: 'consumed' })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', consumedFetch);
    const { unmount } = render(<ApprovalCard request={request} />);
    expect(await screen.findByText('Already used')).toBeTruthy();
    unmount();

    const expiredFetch = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, approvalFixture({ status: 'expired' })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', expiredFetch);
    render(<ApprovalCard request={request} />);
    expect(await screen.findByText('Expired')).toBeTruthy();
  });

  it('a 409 on decision reloads and shows the fresh state', async () => {
    let callCount = 0;
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        return Promise.resolve(errorResponse(409, 'not_pending', 'already decided'));
      }
      if (url === '/api/approvals/apr-42') {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve(jsonResponse(200, approvalFixture()));
        }
        return Promise.resolve(jsonResponse(200, approvalFixture({ status: 'denied' })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Denied')).toBeTruthy();
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));
  });

  it('a failing first load shows Retry; clicking it loads again successfully', async () => {
    let attempt = 0;
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new TypeError('network down'));
        }
        return Promise.resolve(jsonResponse(200, approvalFixture()));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('Could not load the decision state')).toBeTruthy();

    fireEvent.click(retry);

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('disables both buttons while a decision is in flight, so a double click does not double submit', async () => {
    let resolveDecision: (response: Response) => void = () => undefined;
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, approvalFixture()));
      }
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveDecision = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();

    fireEvent.click(approve);
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Approving…' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true);

    // A second click on the same Approve button must not enqueue another POST.
    fireEvent.click(screen.getByRole('button', { name: 'Approving…' }));

    await act(async () => {
      resolveDecision(jsonResponse(200, approvalFixture({ status: 'approved_once' })));
    });

    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(1);
  });
});
