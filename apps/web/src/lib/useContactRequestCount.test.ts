import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listContactRequests, type ContactRequestList } from '@/lib/api';
import { useContactRequestCount } from './useContactRequestCount';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, listContactRequests: vi.fn() };
});

const listMock = vi.mocked(listContactRequests);

const REFRESH_MS = 60 * 1000;

function listWith(incoming: number): ContactRequestList {
  return {
    incoming: Array.from({ length: incoming }, () => ({})),
  } as unknown as ContactRequestList;
}

beforeEach(() => {
  vi.useFakeTimers();
  listMock.mockReset();
  listMock.mockResolvedValue(listWith(2));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useContactRequestCount', () => {
  it('loads at once when enabled and reports the incoming count', async () => {
    const { result } = renderHook(() => useContactRequestCount(true));
    expect(result.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(2);
  });

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() => useContactRequestCount(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    });
    expect(listMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('refetches every 60 seconds', async () => {
    renderHook(() => useContactRequestCount(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('refetches when the window gains focus', async () => {
    renderHook(() => useContactRequestCount(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous count when a refetch fails', async () => {
    const { result } = renderHook(() => useContactRequestCount(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(2);

    listMock.mockRejectedValue(new Error('network down'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(2);
  });

  it('stops refetching on unmount', async () => {
    const { unmount } = renderHook(() => useContactRequestCount(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
