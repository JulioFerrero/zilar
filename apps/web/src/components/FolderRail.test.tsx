import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { ChatFolder } from '@zilar/chat-core';
import { renderApp } from '@/test/renderApp';

function stubWide(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

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

describe('FolderRail', () => {
  it('renders folders on wide screens and sets the active folder on click', () => {
    stubWide(true);
    const { store } = renderApp('/');
    act(() => {
      store.getState().setFolders([folder('f-personal', 'Personal', 'user', 0)]);
    });

    const tablist = screen.getByRole('tablist', { name: 'Chat folders' });
    const nav = tablist.closest('nav');
    expect(nav).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(store.getState().activeFolder).toBe('f-personal');
    expect(screen.getByRole('tab', { name: 'Personal' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('has a tablist, a New key that opens the editor, and an Edit pencil that navigates', async () => {
    stubWide(true);
    const { store } = renderApp('/');
    act(() => {
      store.getState().setFolders([folder('f-personal', 'Personal', 'user', 0)]);
    });

    expect(screen.getByRole('tablist', { name: 'Chat folders' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit folders' }));
    expect(await screen.findByText(/Group chats into folders/)).toBeTruthy();
  });

  it('arrow keys reach New and Edit', () => {
    stubWide(true);
    renderApp('/');

    const allTab = screen.getByRole('tab', { name: /^All chats/ });
    act(() => {
      allTab.focus();
    });
    fireEvent.keyDown(document.activeElement ?? allTab, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('New folder');
    // Arrowing onto New focuses it without opening the editor.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document.activeElement ?? allTab, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit folders');

    fireEvent.keyDown(document.activeElement ?? allTab, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('My AIs');

    fireEvent.keyDown(document.activeElement ?? allTab, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Profile');
  });

  it('hides New at 20 folders', () => {
    stubWide(true);
    const { store } = renderApp('/');
    act(() => {
      store
        .getState()
        .setFolders(
          Array.from({ length: 20 }, (_, index) =>
            folder(`f-${index}`, `Folder ${index}`, 'folder', index),
          ),
        );
    });

    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
  });

  it('has My AIs and Profile foot keys that navigate', () => {
    stubWide(true);
    renderApp('/');

    const aisButton = screen.getByRole('button', { name: 'My AIs' });
    act(() => {
      fireEvent.click(aisButton);
    });
    expect(screen.getByRole('heading', { name: 'My AIs' })).toBeTruthy();
  });

  it('is hidden on narrow screens', () => {
    stubWide(false);
    renderApp('/');

    expect(screen.queryByRole('tab', { name: 'All chats' })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Chat folders' })).toBeTruthy();
  });
});
