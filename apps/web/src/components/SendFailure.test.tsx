import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function message(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: 'm1',
    chatId: 'c-ana',
    senderId: 'u-you',
    senderName: 'You',
    createdAt: new Date(2026, 8, 27, 12, 0),
    status: 'failed',
    failed: true,
    failureReason: 'server_unavailable',
    ...overrides,
  };
}

function renderFailedVoice(overrides: Partial<UiMessage> = {}) {
  return renderApp('/c/c-ana', {
    currentUserId: 'u-you',
    chats: [chat],
    messagesByChat: {
      'c-ana': [
        message({
          voice: {
            duration_ms: 1200,
            mime: 'audio/mp4',
            waveform: [10, 20, 30],
            url: 'blob:local-recording',
          },
          ...overrides,
        }),
      ],
    },
  });
}

describe('failed voice send (T-0168)', () => {
  it('shows Not sent with the reason, Retry and Delete', () => {
    renderFailedVoice();

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('Not sent: Server unavailable')).toBeTruthy();
    expect(within(list).getByLabelText('Retry sending message')).toBeTruthy();
    expect(within(list).getByLabelText('Delete unsent message')).toBeTruthy();
    // No clock: the failure icon replaces it.
    expect(within(list).getByLabelText('Not sent')).toBeTruthy();
    expect(within(list).queryByLabelText('Sending')).toBeNull();
  });

  it('retry moves the bubble back to sending', () => {
    const { store } = renderFailedVoice();

    fireEvent.click(screen.getByLabelText('Retry sending message'));
    expect(store.getState().messages('c-ana')[0]?.failed).toBeUndefined();
    expect(store.getState().messages('c-ana')[0]?.status).toBe('sending');
  });

  it('delete removes the local bubble', () => {
    const { store } = renderFailedVoice();

    fireEvent.click(screen.getByLabelText('Delete unsent message'));
    expect(store.getState().messages('c-ana')).toHaveLength(0);
    expect(screen.queryByText('Not sent: Server unavailable')).toBeNull();
  });

  it('shows the timed-out reason when the send hangs', () => {
    renderFailedVoice({ failureReason: 'timed_out' });

    expect(screen.getByText('Not sent: Timed out')).toBeTruthy();
  });
});
