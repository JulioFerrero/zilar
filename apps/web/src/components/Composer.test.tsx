import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.useRealTimers();
});

describe('Composer', () => {
  it('shows the mic when empty and the send button with text', () => {
    renderApp('/c/c-ana');

    expect(screen.getByLabelText('Record voice message')).toBeTruthy();
    expect(screen.queryByLabelText('Send message')).toBeNull();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });

    expect(screen.getByLabelText('Send message')).toBeTruthy();
    expect(screen.queryByLabelText('Record voice message')).toBeNull();
  });

  it('sends on Enter and moves the message from sending to sent to read', () => {
    vi.useFakeTimers();
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    const textarea = screen.getByLabelText('Message');
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const afterSend = store.getState().messages('c-ana');
    expect(afterSend).toHaveLength(before + 1);
    expect(afterSend.at(-1)?.status).toBe('sending');
    expect(within(screen.getByTestId('message-list')).getByText('ping')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(store.getState().messages('c-ana').at(-1)?.status).toBe('sent');

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(store.getState().messages('c-ana').at(-1)?.status).toBe('read');
  });

  it('does not send on Shift+Enter', () => {
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    const textarea = screen.getByLabelText('Message');
    fireEvent.change(textarea, { target: { value: 'line' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(store.getState().messages('c-ana')).toHaveLength(before);
  });
});
