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

    const nav = screen.getByRole('navigation', { name: 'Chat folders' });
    expect(nav).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(store.getState().activeFolder).toBe('f-personal');
    expect(screen.getByRole('tab', { name: 'Personal' }).getAttribute('aria-selected')).toBe(
      'true',
    );
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

    expect(screen.queryByRole('navigation', { name: 'Chat folders' })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Chat folders' })).toBeTruthy();
  });
});
