import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayed } from './useDelayed';

describe('useDelayed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a value only after it stays for the delay, and hides it at once', () => {
    const { result, rerender } = renderHook(({ value }) => useDelayed(value, 300), {
      initialProps: { value: 'Connecting…' as string | undefined },
    });
    expect(result.current).toBeUndefined();
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('Connecting…');

    rerender({ value: undefined });
    expect(result.current).toBeUndefined();
  });

  it('never shows a value that clears before the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDelayed(value, 300), {
      initialProps: { value: 'Connecting…' as string | undefined },
    });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: undefined });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBeUndefined();
  });

  it('waits again when the same value comes back later', () => {
    const { result, rerender } = renderHook(({ value }) => useDelayed(value, 300), {
      initialProps: { value: 'Connecting…' as string | undefined },
    });
    act(() => vi.advanceTimersByTime(300));
    rerender({ value: undefined });
    act(() => vi.advanceTimersByTime(10));
    rerender({ value: 'Connecting…' });
    expect(result.current).toBeUndefined();
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('Connecting…');
  });
});
