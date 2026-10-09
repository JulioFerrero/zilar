import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, searchMessages } from '@/lib/api';
import { MESSAGE_SEARCH_DEBOUNCE_MS, useMessageSearch } from './useMessageSearch';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, searchMessages: vi.fn() };
});

const searchMock = vi.mocked(searchMessages);

beforeEach(() => {
  vi.useFakeTimers();
  searchMock.mockReset();
  searchMock.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMessageSearch', () => {
  it('waits out the debounce, then searches once with the query', async () => {
    const { result } = renderHook(() => useMessageSearch('hello'));
    expect(result.current).toEqual({ status: 'loading' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGE_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(searchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0]?.[0]).toMatchObject({ q: 'hello', limit: 20 });
    expect(result.current).toEqual({ status: 'ready', items: [] });
  });

  it('stays idle for a query shorter than two characters and never searches', async () => {
    const { result } = renderHook(() => useMessageSearch('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current).toEqual({ status: 'idle' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('a newer query replaces the one still waiting', async () => {
    const { result, rerender } = renderHook(({ query }) => useMessageSearch(query), {
      initialProps: { query: 'hel' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ query: 'hello' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGE_SEARCH_DEBOUNCE_MS);
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0]?.[0]).toMatchObject({ q: 'hello' });
    expect(result.current.status).toBe('ready');
  });

  it('hides the search when the server answers 501', async () => {
    searchMock.mockRejectedValue(new ApiError(501, 'search_unavailable', 'Search is off'));
    const { result } = renderHook(() => useMessageSearch('hello'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGE_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current).toEqual({ status: 'unavailable' });
  });

  it('shows a fixed sentence when the search fails, never the server text', async () => {
    searchMock.mockRejectedValue(new ApiError(500, 'internal', 'database row 42 is broken'));
    const { result } = renderHook(() => useMessageSearch('hello'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGE_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current).toEqual({ status: 'error', message: 'Could not search messages' });
  });
});
