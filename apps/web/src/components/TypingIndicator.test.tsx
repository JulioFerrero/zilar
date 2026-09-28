import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.useRealTimers();
});

describe('typing simulation', () => {
  // The timers here are already faked, so the two-second wait is not the cost.
  // This is the only test in the file, so it alone pays the one-time
  // jsdom/React warm-up and the full-app render (11 chats): ~200 ms idle, but
  // 5.4 s in the busy full-suite run. The test body itself awaits nothing, so
  // there is no delay to fake; the cost is real render work and it gets room.
  it('shows typing in the list and header after two seconds, then hides it', () => {
    vi.useFakeTimers();
    renderApp('/c/c-ana');

    expect(screen.queryByText('typing')).toBeNull();
    expect(screen.queryByText('Luis is typing')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByText('typing').length).toBeGreaterThan(0);
    expect(screen.getByText('Luis is typing')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('typing')).toBeNull();
    expect(screen.queryByText('Luis is typing')).toBeNull();
  }, 15_000);
});
