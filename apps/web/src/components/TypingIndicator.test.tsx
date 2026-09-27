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
  });
});
