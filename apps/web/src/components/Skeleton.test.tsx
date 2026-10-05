import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatListSkeleton, MessageListSkeleton, SKELETON_DELAY_MS } from './Skeleton';

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('skeletons', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows no chat placeholders for a fast load, then shows them after the delay', () => {
    const { container } = render(<ChatListSkeleton rows={3} />);
    expect(screen.getByRole('status', { name: 'Loading chats' })).toBeTruthy();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('shows no message placeholders before the delay', () => {
    const { container } = render(<MessageListSkeleton />);
    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeTruthy();
    expect(container.querySelector('.animate-pulse')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('keeps the chat placeholders but marks them reduced under reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<ChatListSkeleton rows={3} />);

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });

    expect(screen.getByRole('status', { name: 'Loading chats' })).toBeTruthy();
    expect(container.querySelectorAll('.rounded-\\[12px\\]')).toHaveLength(3);
    // The pulse class is gone and the reduced variant takes its place; the
    // reduced variant's `animation: none` (index.css) is what stops the motion.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(container.querySelectorAll('.skeleton-reduced')).toHaveLength(3);
  });

  it('keeps the message placeholders but marks them reduced under reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<MessageListSkeleton />);

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });

    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeTruthy();
    expect(container.querySelectorAll('.rounded-\\[14px\\]')).toHaveLength(4);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(container.querySelector('.skeleton-reduced')).not.toBeNull();
  });
});
