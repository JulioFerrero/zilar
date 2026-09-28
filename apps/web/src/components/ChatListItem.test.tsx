import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { ChatSummary } from '@galena/chat-core';
import { renderApp } from '@/test/renderApp';

const aiChat: ChatSummary = {
  id: 'c-devai',
  title: 'Dev AI',
  kind: 'ai',
  isAI: true,
  space: 'work',
  unread: 0,
  muted: false,
};

const personChat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

describe('ChatListItem', () => {
  it('shows writing… while a draft exists for an AI chat', () => {
    const { store } = renderApp('/', { chats: [aiChat], messagesByChat: {} });

    expect(screen.queryByText('writing…')).toBeNull();

    act(() => {
      store.setState({ drafts: { 'c-devai': { turnId: 't-1', text: 'hello' } } });
    });

    expect(screen.getByText('writing…')).toBeTruthy();
  });

  it('shows typing… while a person types', () => {
    const { store } = renderApp('/', { chats: [personChat], messagesByChat: {} });

    act(() => {
      store.setState({ typing: { 'c-ana': { names: ['Ana'] } } });
    });

    expect(screen.getByText('typing…')).toBeTruthy();
    expect(screen.queryByText('writing…')).toBeNull();
  });
});
