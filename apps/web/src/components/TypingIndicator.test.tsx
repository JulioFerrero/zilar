import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.useRealTimers();
});

describe('typing simulation', () => {
  it('shows typing in the list and header after two seconds, then hides it', () => {
    vi.useFakeTimers();
    renderApp('/c/c-ana');

    expect(screen.queryByText('typing')).toBeNull();
    expect(screen.queryByText('typing…')).toBeNull();
    expect(screen.queryByText('Luis is typing…')).toBeNull();
    expect(screen.queryByText('writing…')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // The header keeps D23's DM label; the list rows add the ellipsis.
    expect(screen.getByText('typing')).toBeTruthy();
    expect(screen.getAllByText('typing…').length).toBeGreaterThan(0);
    expect(screen.getByText('Luis is typing…')).toBeTruthy();
    expect(screen.queryByText('writing…')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('typing')).toBeNull();
    expect(screen.queryByText('typing…')).toBeNull();
    expect(screen.queryByText('Luis is typing…')).toBeNull();
    expect(screen.queryByText('writing…')).toBeNull();
  });
});
