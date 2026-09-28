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
    expect(screen.queryByText('writing…')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // The header keeps the D23 label; the redesigned list rows read `writing…`.
    expect(screen.getByText('typing')).toBeTruthy();
    expect(screen.getAllByText('writing…').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('typing')).toBeNull();
    expect(screen.queryByText('writing…')).toBeNull();
  });
});
