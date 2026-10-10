import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ChatFolder } from '@zilar/chat-core';

import { FolderTabs } from './folder-tabs';

vi.mock('lucide-react-native', () => ({ MessagesSquare: 'MessagesSquare' }));
vi.mock('./folder-icon', () => ({ folderIcon: () => 'FolderIcon' }));
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/lib/colors', () => ({
  FOREGROUND: '#fff',
  MUTED_FOREGROUND: '#888',
}));

function folder(id: string, name: string): ChatFolder {
  return {
    id,
    name,
    icon: 'folder',
    position: 0,
    includeTypes: [],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
  };
}

const FOLDERS = [folder('f-personal', 'Personal'), folder('f-ais', 'AIs')];

function render(overrides: Partial<Parameters<typeof FolderTabs>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(FolderTabs, {
      activeFolder: 'all',
      folders: FOLDERS,
      counts: { all: 0, 'f-personal': 0, 'f-ais': 0 },
      onSelect: () => {},
      ...overrides,
    }),
  );
}

describe('FolderTabs', () => {
  it('renders All chats first, then one chip per server folder', () => {
    const markup = render();
    expect(markup).toContain('All chats');
    expect(markup).toContain('Personal');
    expect(markup).toContain('AIs');
    expect(markup.indexOf('All chats')).toBeLessThan(markup.indexOf('Personal'));
  });

  it('shows a count only when it is above zero', () => {
    const markup = render({ counts: { all: 0, 'f-personal': 3, 'f-ais': 0 } });
    expect(markup).toContain('>3<');
    expect(markup).not.toContain('>0<');
  });
});
