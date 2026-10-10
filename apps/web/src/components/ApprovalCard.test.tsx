import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApprovalRequestSchema, decodeOrThrow } from '@zilar/protocol';
import { ApprovalCard } from './ApprovalCard';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const request = decodeOrThrow(ApprovalRequestSchema)({
  id: 'apr-42',
  room: 'dev-team@rooms.zilar.test',
  ai: 'dev-1@ai.zilar.test',
  action: 'merge_pull_request',
  summary: 'Merge PR #42 — fix the checkout button on mobile Safari',
  details: 'Squash-merges the branch into main.',
  args_hash: 'a'.repeat(64),
  worst_case_cost: { currency: 'EUR', amount: 0.4 },
  requested_by: 'dev-1@ai.zilar.test',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});

interface ApprovalFixture {
  id: string;
  status: 'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';
  expiresAt: string;
  action?: string;
  alwaysEligible?: boolean;
  groupId?: string | null;
  topicId?: string | null;
  topicName?: string | null;
  approverNames?: string[];
}

function approvalFixture({
  id = 'apr-42',
  status = 'pending',
  expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
  action = 'merge_pull_request',
  alwaysEligible = false,
  groupId = 'dev-team',
  topicId = null,
  topicName = null,
  approverNames = [],
}: Partial<ApprovalFixture> = {}): unknown {
  return {
    id,
    aiId: 'ai-dev-1',
    groupId,
    topicId,
    topicName,
    action,
    summary: 'Merge PR #42',
    details: null,
    argsHash: 'a'.repeat(64),
    worstCase: null,
    requestedBy: 'dev-1@ai.zilar.test',
    status,
    decidedAt: status === 'pending' ? null : new Date().toISOString(),
    note: null,
    expiresAt,
    createdAt: new Date().toISOString(),
    alwaysEligible,
    approverNames,
  };
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

  it('shows the decided state once a poll returns approved_once, without a click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let pending = approvalFixture();
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, pending));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(approve).toBeTruthy();

    // The next poll decides the approval.
    pending = approvalFixture({ status: 'approved_once' });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('drops the buttons when a poll returns expired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let pending = approvalFixture();
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, pending));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });

    pending = approvalFixture({ status: 'expired' });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(await screen.findByText('Expired')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });
});

// T-0100: the "Always allow here" third button. It shows only for a
// pending, decidable, eligible approval; the first click arms an inline
// confirmation naming the scope, and Confirm sends `approve_always`.
describe('ApprovalCard always allow (T-0100)', () => {
  it('hides the third button when the approval is not eligible', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(200, approvalFixture({ alwaysEligible: false })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });

    expect(screen.queryByRole('button', { name: 'Always allow here' })).toBeNull();
  });

  it('hides the third button for a non-decider, with no error', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(errorResponse(404, 'not_found', 'Approval not found'));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);

    expect(await screen.findByText('Waiting for a decision')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Always allow here' })).toBeNull();
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  it('confirms with the personal-chat wording and sends approve_always', async () => {
    let approval = approvalFixture({ alwaysEligible: true, groupId: null });
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, approval));
      }
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ decision: 'approve_always' });
        approval = approvalFixture({
          status: 'approved_always',
          alwaysEligible: true,
          groupId: null,
        });
        return Promise.resolve(jsonResponse(200, approval));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Always allow here' }));

    // The buttons swap for the inline confirmation naming this chat.
    expect(
      screen.getByText('Always run merge_pull_request without asking, in this chat only.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Always allow here' })).toBeNull();
  });

  it('confirms with the group wording when the approval is group-scoped', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(
          jsonResponse(200, approvalFixture({ alwaysEligible: true, groupId: 'dev-team' })),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Always allow here' }));

    expect(
      screen.getByText('Always run merge_pull_request without asking, in this group only.'),
    ).toBeTruthy();
  });

  it('Cancel restores the buttons without a request', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(
          jsonResponse(200, approvalFixture({ alwaysEligible: true, groupId: null })),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Always allow here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Always allow here' })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('always_not_allowed shows the message and hides the third button', async () => {
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(
          jsonResponse(200, approvalFixture({ alwaysEligible: true, groupId: null })),
        );
      }
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        return Promise.resolve(
          errorResponse(400, 'always_not_allowed', 'This action cannot be always allowed'),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Always allow here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('This action can only be approved one time.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Always allow here' })).toBeNull();
    // The one-time buttons stay: the request is still pending.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });

  it('always_requires_admin shows the message and hides the third button', async () => {
    const fetchMock = makeFetch((url, init) => {
      if (url === '/api/approvals/apr-42' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(
          jsonResponse(200, approvalFixture({ alwaysEligible: true, groupId: 'dev-team' })),
        );
      }
      if (url === '/api/approvals/apr-42/decision' && init?.method === 'POST') {
        return Promise.resolve(
          errorResponse(403, 'always_requires_admin', 'Only a group admin can always allow'),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Always allow here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('Only a group admin can always allow an action here.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Always allow here' })).toBeNull();
    // The one-time buttons stay: the request is still pending.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });

  it('never shows the third button after a decision', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(
          jsonResponse(200, approvalFixture({ status: 'approved_always', alwaysEligible: true })),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);

    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Always allow here' })).toBeNull();
  });
});

describe('ApprovalCard approvers line (T-0141)', () => {
  it('shows "Approvers: Designers, Luis" from the list payload with no topic fetch', async () => {
    // The approver names ride the approvals payload (T-0134), so N cards
    // cause no per-card `getTopic` (N+1). Any fetch outside the approval
    // read itself rejects, so a per-card topic fetch would fail the card.
    // Fails on the old code (the card fetched `/api/topics/t-hiring` per
    // card and read the approver role off the topic).
    const fetched: string[] = [];
    const fetchMock = makeFetch((url) => {
      fetched.push(url);
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(
          jsonResponse(
            200,
            approvalFixture({
              topicId: 't-hiring',
              topicName: 'Hiring',
              approverNames: ['Designers', 'Luis'],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });
    expect(await screen.findByText('Approvers: Designers, Luis')).toBeTruthy();
    expect(fetched.filter((url) => url.startsWith('/api/topics/'))).toEqual([]);
  });

  it('hides the line when the payload carries no approver names', async () => {
    const fetchMock = makeFetch((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(
          jsonResponse(
            200,
            approvalFixture({ topicId: 't-hiring', topicName: 'Hiring', approverNames: [] }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ApprovalCard request={request} />);
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.queryByText(/Approvers:/)).toBeNull();
  });

  it('renders N cards with no per-card topic fetch', async () => {
    // Three cards in three topics: the old code issued one `getTopic` per
    // card. Any fetch outside the three approval reads rejects, so an N+1
    // would fail the render.
    const fetched: string[] = [];
    const ids = ['apr-1', 'apr-2', 'apr-3'];
    const fetchMock = makeFetch((url) => {
      fetched.push(url);
      const match = url.match(/^\/api\/approvals\/(apr-\d)$/);
      if (match?.[1] !== undefined) {
        const approvalId = match[1];
        return Promise.resolve(
          jsonResponse(
            200,
            approvalFixture({
              id: approvalId,
              topicId: `t-${approvalId}`,
              topicName: `Topic ${approvalId}`,
              approverNames: ['Designers'],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    for (const id of ids) {
      const parsed = decodeOrThrow(ApprovalRequestSchema)({ ...request, id });
      render(<ApprovalCard request={parsed} />);
    }
    await waitFor(() => {
      expect(screen.getAllByText('Approvers: Designers')).toHaveLength(3);
    });
    expect(fetched.filter((url) => url.startsWith('/api/topics/'))).toEqual([]);
    expect(fetched.filter((url) => url.startsWith('/api/approvals/'))).toHaveLength(3);
  });
});
