import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingApprovalCount } from './usePendingApprovalCount';

function makeApproval(status: 'pending' | 'approved_once' | 'denied'): unknown {
  return {
    id: `apr-${status}`,
    aiId: 'ai-dev-1',
    groupId: 'dev-team',
    action: 'merge_pull_request',
    summary: 'Merge PR',
    details: null,
    argsHash: 'a'.repeat(64),
    worstCase: null,
    requestedBy: 'dev-1@ai.zilar.test',
    status,
    decidedAt: status === 'pending' ? null : new Date().toISOString(),
    note: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function jsonResponse(body: unknown, httpStatus = 200): Response {
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePendingApprovalCount', () => {
  it('does not fetch until enabled flips to true', async () => {
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/approvals') {
          fetchCount += 1;
          return Promise.resolve(jsonResponse([makeApproval('pending')]));
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    const { rerender } = renderHook(({ enabled }) => usePendingApprovalCount(enabled), {
      initialProps: { enabled: false },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(0);

    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(1);
  });

  it('counts pending approvals only and reports the number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/approvals') {
          return Promise.resolve(
            jsonResponse([
              makeApproval('pending'),
              makeApproval('pending'),
              makeApproval('pending'),
              makeApproval('approved_once'),
              makeApproval('denied'),
            ]),
          );
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    const { result } = renderHook(() => usePendingApprovalCount(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(3);
  });

  it('starts at null until the first fetch settles', async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            if (url === '/api/approvals') {
              resolveFetch = resolve;
            } else {
              resolve(jsonResponse([]));
            }
          }),
      ),
    );

    const { result } = renderHook(() => usePendingApprovalCount(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBeNull();

    await act(async () => {
      resolveFetch(jsonResponse([makeApproval('pending'), makeApproval('pending')]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(2);
  });

  it('keeps the previous value when a follow-up call fails', async () => {
    let mode: 'ok' | 'fail' = 'ok';
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/approvals') {
          fetchCount += 1;
          if (mode === 'fail') {
            return Promise.reject(new TypeError('network down'));
          }
          return Promise.resolve(jsonResponse([makeApproval('pending')]));
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    const { result, rerender } = renderHook(({ enabled }) => usePendingApprovalCount(enabled), {
      initialProps: { enabled: true },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(1);
    expect(fetchCount).toBe(1);

    // Reopen the menu: that triggers a new fetch.
    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(1);

    mode = 'fail';
    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(2);
    // The previous value (1) is preserved when the new fetch fails.
    expect(result.current).toBe(1);
  });
});
