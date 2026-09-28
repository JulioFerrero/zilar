import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { ChatSummary } from '@galena/chat-core';
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

describe('ChatListItem', () => {
  it('shows writing… while a draft exists for the chat', () => {
    const { store } = renderApp('/', { chats: [chat], messagesByChat: {} });

    expect(screen.queryByText('writing…')).toBeNull();

    act(() => {
      store.setState({ drafts: { 'c-ana': { turnId: 't-1', text: 'hello' } } });
    });

    expect(screen.getByText('writing…')).toBeTruthy();
  });
});
