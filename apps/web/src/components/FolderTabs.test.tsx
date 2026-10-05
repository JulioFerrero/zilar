import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ChatFolder, ChatSummary } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

function folder(id: string, name: string, icon: ChatFolder['icon'], position: number): ChatFolder {
  return {
    id,
    name,
    icon,
    position,
    includeTypes: [],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
  };
}

const FOLDERS: ChatFolder[] = [
  folder('f-personal', 'Personal', 'user', 0),
  folder('f-ais', 'AIs', 'bot', 1),
];

function chat(id: string, kind: ChatSummary['kind'], unread: number, muted = false): ChatSummary {
  return {
    id,
    title: id,
    kind,
    isAI: kind === 'ai',
    space: 'personal',
    unread,
    muted,
    memberCount: 2,
  };
}

describe('FolderTabs', () => {
  it('renders All chats plus one chip per folder with counts hidden at 0', () => {
    const { store } = renderApp('/');
    act(() => {
      store.getState().setFolders(FOLDERS);
    });

    const tablist = screen.getByRole('tablist', { name: 'Chat folders' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(
      within(tablist)
        .getByRole('tab', { name: /All chats/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(within(tablist).getByRole('tab', { name: 'Personal' }).textContent).toBe('Personal');
    expect(within(tablist).getByRole('tab', { name: 'AIs' }).textContent).toBe('AIs');
  });

  it('shows unread counts and skips muted chats', () => {
    const { store } = renderApp('/', {
      chats: [chat('c-dm', 'dm', 3), chat('c-muted', 'dm', 5, true)],
    });
    act(() => {
      store.getState().setFolders(FOLDERS);
    });

    const tablist = screen.getByRole('tablist', { name: 'Chat folders' });
    // Muted chats are skipped (folderUnreadTotal), so only 3 remain.
    expect(within(tablist).getByRole('tab', { name: /All chats/ }).textContent).toContain('3');
    // Folders with no matching chats show no count badge.
    expect(within(tablist).getByRole('tab', { name: 'Personal' }).textContent).toBe('Personal');
  });

  it('moves selection and focus with the arrow keys', () => {
    const { store } = renderApp('/');
    act(() => {
      store.getState().setFolders(FOLDERS);
    });

    const all = screen.getByRole('tab', { name: /All chats/ });
    fireEvent.keyDown(all, { key: 'ArrowRight' });

    const personal = screen.getByRole('tab', { name: 'Personal' });
    expect(personal.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(personal);
    expect(store.getState().activeFolder).toBe('f-personal');

    fireEvent.keyDown(personal, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'AIs' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'AIs' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Personal' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
