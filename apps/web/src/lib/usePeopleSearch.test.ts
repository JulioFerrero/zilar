import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, lookupByHandle, type HandleProfile } from '@/lib/api';
import { PEOPLE_SEARCH_DEBOUNCE_MS, usePeopleSearch } from './usePeopleSearch';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, lookupByHandle: vi.fn() };
});

const lookupMock = vi.mocked(lookupByHandle);

const profile = { handle: 'alice' } as HandleProfile;

beforeEach(() => {
  vi.useFakeTimers();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue(profile);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePeopleSearch', () => {
  it('looks a handle up only after 900 ms without typing', async () => {
    const { result } = renderHook(() => usePeopleSearch('@alice'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEOPLE_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(lookupMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(lookupMock).toHaveBeenCalledWith('alice');
    expect(result.current.state).toEqual({ status: 'found', handle: 'alice', profile });
  });

  it('never looks up a text that does not start with @', async () => {
    const { result } = renderHook(() => usePeopleSearch('alice'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEOPLE_SEARCH_DEBOUNCE_MS * 2);
    });
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('does not look up the same handle twice after a success', async () => {
    const { rerender } = renderHook(({ query }) => usePeopleSearch(query), {
      initialProps: { query: '@alice' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEOPLE_SEARCH_DEBOUNCE_MS);
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);

    rerender({ query: '@ALICE' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEOPLE_SEARCH_DEBOUNCE_MS * 2);
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('reports a missing handle when the lookup answers 404', async () => {
    lookupMock.mockRejectedValue(new ApiError(404, 'not_found', 'Not found'));
    const { result } = renderHook(() => usePeopleSearch('@ghost'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEOPLE_SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.state).toEqual({ status: 'missing', handle: 'ghost' });
  });

  it('Enter looks the handle up at once, without the debounce', async () => {
    const { result } = renderHook(() => usePeopleSearch('@alice'));
    await act(async () => {
      window.dispatchEvent(new Event('zilar:search-enter'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('found');
  });
});
