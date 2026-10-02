import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalRequestSchema } from '@zilar/protocol';
import {
  APPROVAL_POLL_INTERVAL_MS,
  useApprovalPolling,
  type TimerSource,
  type VisibilitySource,
} from './useApprovalPolling';

const baseRequest = ApprovalRequestSchema.parse({
  id: 'apr-42',
  room: 'dev-team@rooms.zilar.test',
  ai: 'dev-1@ai.zilar.test',
  action: 'merge_pull_request',
  summary: 'Merge PR #42',
  args_hash: 'a'.repeat(64),
  worst_case_cost: { currency: 'EUR', amount: 0.4 },
  requested_by: 'dev-1@ai.zilar.test',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});

function makeApproval(
  status: 'pending' | 'approved_once' | 'denied' | 'consumed' | 'expired',
  overrides: Partial<{ id: string; expiresAt: string }> = {},
): unknown {
  return {
    id: overrides.id ?? 'apr-42',
    aiId: 'ai-dev-1',
    groupId: 'dev-team',
    action: 'merge_pull_request',
    summary: 'Merge PR #42',
    details: null,
    argsHash: 'a'.repeat(64),
    worstCase: null,
    requestedBy: 'dev-1@ai.zilar.test',
    status,
    decidedAt: status === 'pending' ? null : new Date().toISOString(),
    note: null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function jsonResponse(body: unknown, httpStatus = 200): Response {
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(httpStatus: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, httpStatus);
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function makeFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  });
}

interface Harness {
  visibility: VisibilitySource;
  visibilityListeners: Set<() => void>;
  visible: boolean;
  timers: TimerSource;
  now: () => number;
  rewire: (handler: FetchHandler) => void;
  pending: () => number;
  setVisible: (value: boolean) => void;
  setNow: (value: number) => void;
}

function createHarness(): Harness {
  const visibilityListeners = new Set<() => void>();
  const visibleBox = { value: true };
  const nowBox = { value: Date.now() };
  let fetchMock: ReturnType<typeof vi.fn> | undefined;

  const timers: TimerSource = {
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };

  return {
    visibility: {
      isVisible: () => visibleBox.value,
      subscribe: (onVisible) => {
        visibilityListeners.add(onVisible);
        return () => visibilityListeners.delete(onVisible);
      },
    },
    visibilityListeners,
    get visible(): boolean {
      return visibleBox.value;
    },
    set visible(value: boolean) {
      visibleBox.value = value;
    },
    timers,
    now: () => nowBox.value,
    rewire: (handler) => {
      fetchMock = makeFetch(handler);
      vi.stubGlobal('fetch', fetchMock);
    },
    pending: () => {
      if (fetchMock === undefined) {
        return 0;
      }
      return fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method !== 'POST',
      ).length;
    },
    setVisible: (value) => {
      visibleBox.value = value;
    },
    setNow: (value) => {
      nowBox.value = value;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useApprovalPolling', () => {
  it('polls every 10 seconds while the approval is pending and the tab is visible', async () => {
    const harness = createHarness();
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(makeApproval('pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { unmount } = renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    // First read right away.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.pending()).toBe(1);

    // Each tick fetches again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS);
    });
    expect(harness.pending()).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS);
    });
    expect(harness.pending()).toBe(3);

    unmount();
  });

  it('does not poll while the tab is hidden', async () => {
    const harness = createHarness();
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(makeApproval('pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.pending()).toBe(1);

    harness.setVisible(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS * 3);
    });
    expect(harness.pending()).toBe(1);
  });

  it('refreshes once when the tab becomes visible again', async () => {
    const harness = createHarness();
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(makeApproval('pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.pending()).toBe(1);

    harness.setVisible(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS);
    });
    expect(harness.pending()).toBe(1);

    // Returning to visible triggers one immediate read.
    harness.setVisible(true);
    await act(async () => {
      for (const listener of harness.visibilityListeners) {
        listener();
      }
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.pending()).toBe(2);
  });

  it('stops polling once the status is no longer pending', async () => {
    const harness = createHarness();
    let approved = false;
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(makeApproval(approved ? 'approved_once' : 'pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { result } = renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.kind).toBe('ready');

    // Flip the server: next poll decides the approval.
    approved = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS);
    });
    expect(result.current.state.kind).toBe('ready');
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.approval.status).toBe('approved_once');
    }

    // No further polls.
    const callsAfterDecision = harness.pending();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS * 5);
    });
    expect(harness.pending()).toBe(callsAfterDecision);
  });

  it('a failed poll keeps the last good state', async () => {
    const harness = createHarness();
    let mode: 'ok' | 'fail' = 'ok';
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        if (mode === 'fail') {
          return Promise.reject(new TypeError('network down'));
        }
        return Promise.resolve(jsonResponse(makeApproval('pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { result } = renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.kind).toBe('ready');

    // Now the network starts failing. The hook must not replace the ready
    // state with an error state.
    mode = 'fail';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS * 3);
    });
    expect(result.current.state.kind).toBe('ready');
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.approval.status).toBe('pending');
    }
  });

  it('stops polling on unmount', async () => {
    const harness = createHarness();
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        return Promise.resolve(jsonResponse(makeApproval('pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { unmount } = renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.pending()).toBe(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS * 5);
    });
    expect(harness.pending()).toBe(1);
  });

  it('stops polling on an id change and refetches the new one', async () => {
    const harness = createHarness();
    const seenIds: string[] = [];
    harness.rewire((url) => {
      if (url.startsWith('/api/approvals/')) {
        const id = decodeURIComponent(url.slice('/api/approvals/'.length));
        seenIds.push(id);
        return Promise.resolve(jsonResponse(makeApproval('pending', { id })));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { rerender } = renderHook(
      ({ id }) =>
        useApprovalPolling(ApprovalRequestSchema.parse({ ...baseRequest, id }), {
          visibility: harness.visibility,
          timers: harness.timers,
          now: harness.now,
        }),
      { initialProps: { id: 'apr-42' } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seenIds).toEqual(['apr-42']);

    rerender({ id: 'apr-99' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seenIds).toEqual(['apr-42', 'apr-99']);
  });

  it('does one final read after expires_at passes', async () => {
    const harness = createHarness();
    const expiresAt = new Date(Date.now() + 1_000).toISOString();
    const request = ApprovalRequestSchema.parse({ ...baseRequest, expires_at: expiresAt });
    const expiresAtMs = new Date(expiresAt).getTime();
    harness.setNow(expiresAtMs - 500);

    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        // Once we're past expiry, the server reports `expired`.
        const expired = harness.now() >= expiresAtMs;
        return Promise.resolve(
          jsonResponse(makeApproval(expired ? 'expired' : 'pending', { expiresAt })),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { result } = renderHook(() =>
      useApprovalPolling(request, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.kind).toBe('ready');
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.approval.status).toBe('pending');
    }

    // Jump past expiry. The next tick fires the final read; the server answers
    // `expired` and the hook settles on that.
    harness.setNow(expiresAtMs + 100);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS);
    });
    expect(result.current.state.kind).toBe('ready');
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.approval.status).toBe('expired');
    }
  });

  it('stops polling after a 404 (the viewer cannot decide)', async () => {
    const harness = createHarness();
    let mode: 'ok' | 'not_found' = 'ok';
    harness.rewire((url) => {
      if (url === '/api/approvals/apr-42') {
        if (mode === 'not_found') {
          return Promise.resolve(errorResponse(404, 'not_found', 'Approval not found'));
        }
        return Promise.resolve(jsonResponse(makeApproval('pending')));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const { result } = renderHook(() =>
      useApprovalPolling(baseRequest, {
        visibility: harness.visibility,
        timers: harness.timers,
        now: harness.now,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state.kind).toBe('ready');

    mode = 'not_found';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS);
    });
    expect(result.current.state.kind).toBe('notDecidable');

    const callsAtStop = harness.pending();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APPROVAL_POLL_INTERVAL_MS * 5);
    });
    expect(harness.pending()).toBe(callsAtStop);
  });
});
