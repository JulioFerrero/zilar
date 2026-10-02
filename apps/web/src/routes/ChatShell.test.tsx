import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

function at(daysAgo: number, hour: number, minute: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function seededMessage(
  id: string,
  senderId: string,
  senderName: string,
  createdAt: Date,
  text: string,
): UiMessage {
  return {
    id,
    chatId: 'c-test',
    senderId,
    senderName,
    text,
    createdAt,
    status: 'read',
  };
}

describe('ChatShell', () => {
  it('shows the header subtitle, date separators and grouped bubbles', () => {
    // T-0111: `c-devteam` is the General topic now, with its own short
    // thread; the legacy full thread moved to the bug topic.
    renderApp('/c/c-devteam-bug');
    const messageList = screen.getByTestId('message-list');

    expect(screen.getAllByText('Dev team').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Checkout button hidden on Safari').length).toBeGreaterThan(0);
    expect(within(messageList).getByText('Opening Checkout button hidden on Safari.')).toBeTruthy();
  });

  it('shows the sender name only on the first bubble of a group', () => {
    const chat: ChatSummary = {
      id: 'c-test',
      title: 'Test chat',
      kind: 'group',
      isAI: false,
      space: 'personal',
      unread: 2,
      muted: false,
      memberCount: 3,
    };
    const messages: UiMessage[] = [
      seededMessage('m1', 'ai-nova', 'Nova', at(0, 10, 0), 'one'),
      seededMessage('m2', 'ai-nova', 'Nova', at(0, 10, 2), 'two'),
      seededMessage('m3', 'u-bea', 'Bea', at(0, 10, 4), 'three'),
    ];

    renderApp('/c/c-test', { chats: [chat], messagesByChat: { 'c-test': messages } });

    expect(screen.getAllByText('Nova')).toHaveLength(1);
    expect(screen.getAllByText('Bea')).toHaveLength(1);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('clears the unread count when the chat opens', () => {
    const chat: ChatSummary = {
      id: 'c-test',
      title: 'Test chat',
      kind: 'dm',
      isAI: false,
      space: 'personal',
      unread: 4,
      muted: false,
      online: true,
    };
    const messages: UiMessage[] = [seededMessage('m1', 'u-bea', 'Bea', at(0, 10, 0), 'hi')];

    const { store } = renderApp('/c/c-test', {
      chats: [chat],
      messagesByChat: { 'c-test': messages },
    });

    expect(store.getState().chats[0]?.unread).toBe(0);
    expect(screen.queryByLabelText('4 unread')).toBeNull();
    expect(screen.getByText('online')).toBeTruthy();
  });
});
