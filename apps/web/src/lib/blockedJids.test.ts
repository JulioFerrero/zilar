import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from './api';
import { refreshBlockedJids, resetBlockedJidsForTests, useBlockedJids } from './blockedJids';

const listMock = vi.fn();

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    listBlockedUsers: (...args: unknown[]) => listMock(...args),
  };
});

// window.focus reloads the set through the real listener path.
function focusWindow(): void {
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
}

describe('blockedJids', () => {
  beforeEach(() => {
    resetBlockedJidsForTests();
    listMock.mockReset();
    vi.restoreAllMocks();
  });

  it('loads lowercased bare JIDs on first use', async () => {
    listMock.mockResolvedValue([
      { userId: 'u-bob', name: 'Bob', handle: 'bob_b', image: null, jid: 'Bob@zilar.test' },
      { userId: 'u-ana', name: 'Ana', handle: null, image: null, jid: null },
    ]);
    const { result } = renderHook(() => useBlockedJids());

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.has('bob')).toBe(true);
    expect(result.current.size).toBe(1);
  });

  it('refreshes on window focus and keeps the last good set on errors', async () => {
    listMock.mockResolvedValue([
      { userId: 'u-bob', name: 'Bob', handle: 'bob_b', image: null, jid: 'bob@zilar.test' },
    ]);
    const { result } = renderHook(() => useBlockedJids());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.has('bob')).toBe(true);

    // The blocker unblocked Bob: the focus reload drops him from the set.
    listMock.mockResolvedValue([]);
    focusWindow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.size).toBe(0);

    // A failed reload keeps the last good set (still empty here is fine);
    // reload good data first, then fail.
    listMock.mockResolvedValue([
      { userId: 'u-ana', name: 'Ana', handle: null, image: null, jid: 'ana@zilar.test' },
    ]);
    await act(async () => {
      await refreshBlockedJids();
    });
    expect(result.current.has('ana')).toBe(true);

    listMock.mockRejectedValueOnce(new ApiError(500, 'request_failed', 'boom'));
    await act(async () => {
      await refreshBlockedJids();
    });
    expect(result.current.has('ana')).toBe(true);
  });

  it('refreshBlockedJids updates the set', async () => {
    listMock.mockResolvedValue([]);
    const { result } = renderHook(() => useBlockedJids());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.size).toBe(0);

    listMock.mockResolvedValue([
      { userId: 'u-bob', name: 'Bob', handle: null, image: null, jid: 'bob@zilar.test' },
    ]);
    await act(async () => {
      await refreshBlockedJids();
    });
    expect(result.current.has('bob')).toBe(true);
  });
});
