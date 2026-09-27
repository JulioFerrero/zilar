import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@galena/chat-core';
import { renderApp } from '@/test/renderApp';

const chat: ChatSummary = {
  id: 'c-test',
  title: 'Test chat',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function textMessage(text: string): UiMessage {
  return {
    id: 'm1',
    chatId: 'c-test',
    senderId: 'u-bea',
    senderName: 'Bea',
    text,
    createdAt: new Date(2026, 8, 27, 12, 41),
    status: 'read',
  };
}

function render(text: string) {
  return renderApp('/c/c-test', {
    chats: [chat],
    messagesByChat: { 'c-test': [textMessage(text)] },
  });
}

describe('message content', () => {
  it('renders a big-emoji message without a bubble', () => {
    render('😂😂');

    const emoji = screen.getByText('😂😂');
    expect(emoji.closest('.bg-bubble-in')).toBeNull();
    expect(emoji.closest('.bg-bubble-out')).toBeNull();
  });

  it('links http and https URLs with target and rel', () => {
    render('see https://x.com/a). now');

    const list = screen.getByTestId('message-list');
    const link = within(list).getByRole('link');
    expect(link.textContent).toBe('https://x.com/a');
    expect(link.getAttribute('href')).toBe('https://x.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders an unsafe scheme as plain text', () => {
    render('javascript:alert(1)');

    const list = screen.getByTestId('message-list');
    expect(within(list).queryByRole('link')).toBeNull();
    expect(within(list).getByText('javascript:alert(1)')).toBeTruthy();
  });

  it('shows the full date and time on the bubble time', () => {
    render('hello');

    const list = screen.getByTestId('message-list');
    const time = within(list).getByText('12:41');
    expect(time.getAttribute('title')).toContain('2026');
  });
});
