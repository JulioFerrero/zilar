import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatListSkeleton, MessageListSkeleton, SKELETON_DELAY_MS } from './Skeleton';

describe('skeletons', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
