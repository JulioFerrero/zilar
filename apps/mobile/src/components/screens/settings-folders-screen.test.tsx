import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ChatFolder } from '@zilar/chat-core';
import { flushTasks as flush } from '@/test/wait';

// Settings → Chat folders. The list comes from the chat store, so the store
// selector is stubbed. The body's only own state is the error text, forced
// through the `useState` mock. Every setter call is recorded in `setCalls`,
// and the row buttons (Move up / Move down / Edit) are captured while rendering.
const NONE = Symbol('none');

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  Plus: 'Plus',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/chat/folder-icon', () => ({
  folderIcon: () => 'FolderIcon',
}));

vi.mock('@/components/settings/screen-shell', () => ({
  SettingsScreenShell: ({ title, children }: { title: string; children: React.ReactNode }) =>
    createElement('SettingsScreenShell', null, title, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    accessibilityLabel,
    onPress,
    children,
  }: {
    accessibilityLabel?: string;
    onPress?: () => void;
    children?: React.ReactNode;
  }) => {
    if (accessibilityLabel !== undefined && onPress !== undefined) {
      handlers[accessibilityLabel] = onPress;
    }
    return createElement('Button', null, children);
  },
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => createElement('Card', null, children),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress?: () => void;
    disabled?: boolean;
  }) => {
    if (onPress !== undefined) {
      handlers[label] = onPress;
    }
    return createElement('IconButton', { disabled: disabled === true }, label);
  },
}));

vi.mock('@/components/ui/icon-tile', () => ({
  IconTile: ({ children }: { children: React.ReactNode }) =>
    createElement('IconTile', null, children),
}));

vi.mock('@/components/ui/list-row', () => ({
  ListRow: ({
    title,
    subtitle,
    accessibilityLabel,
    onPress,
  }: {
    title: string;
    subtitle: string;
    accessibilityLabel?: string;
    onPress?: () => void;
  }) => {
    if (accessibilityLabel !== undefined && onPress !== undefined) {
      handlers[accessibilityLabel] = onPress;
    }
    return createElement('ListRow', null, title, subtitle);
  },
}));

vi.mock('@/components/ui/state-message', () => ({
  StateMessage: ({ title }: { title: string }) => createElement('StateMessage', null, title),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
}));

let store: { folders: ChatFolder[]; reorderFolders: (ids: string[]) => Promise<void> } = {
  folders: [],
  reorderFolders: async () => {},
};

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector(store),
}));

let handlers: Record<string, () => void> = {};
let forced: unknown[] = [];
let cursor = 0;
let setCalls: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      const index = cursor;
      cursor += 1;
      const value = index < forced.length && forced[index] !== NONE ? forced[index] : initial;
      return [
        value as T,
        ((next: unknown) => {
          setCalls.push(next);
        }) as Dispatch<SetStateAction<T>>,
      ];
    },
  };
});

function folder(id: string, name: string, position: number): ChatFolder {
  return {
    id,
    name,
    icon: 'folder',
    position,
    includeTypes: ['dm'],
    includeChats: [],
    excludeChats: [],
    excludeMuted: false,
    excludeRead: false,
  };
}

const WORK = folder('f1', 'Work', 0);
const FAMILY = folder('f2', 'Family', 1);

const REORDER_FAILED = 'Could not reorder folders. Try again.';

async function renderScreen(input: { folders: ChatFolder[]; error?: string }): Promise<string> {
  store = { ...store, folders: input.folders };
  forced = [input.error ?? ''];
  cursor = 0;
  setCalls = [];
  handlers = {};
  try {
    const module = await import('@/app/settings/folders');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forced = [];
  }
}

// Lets the press handler's promise chain and any Effect run finish.
describe('FoldersSettingsScreen', () => {
  it('shows the empty state when there are no folders', async () => {
    const html = await renderScreen({ folders: [] });
    expect(html).toContain('No folders yet.');
    expect(html).toContain('New folder');
  });

  it('lists folders with move and edit controls', async () => {
    const html = await renderScreen({ folders: [WORK, FAMILY] });
    expect(html).toContain('Chat folders');
    expect(html).toContain('Work');
    expect(html).toContain('Family');
    expect(html).toContain('Move Work up');
    expect(html).toContain('Move Work down');
    expect(handlers['Edit Work']).toBeDefined();
    expect(handlers['Edit Family']).toBeDefined();
  });

  it('shows the folder limit notice at the limit', async () => {
    const many = Array.from({ length: 20 }, (_, index) => folder(`f${index}`, `F${index}`, index));
    const html = await renderScreen({ folders: many });
    expect(html).toContain('You can have up to 20 folders.');
  });

  it('shows the reorder error', async () => {
    const html = await renderScreen({ folders: [WORK, FAMILY], error: REORDER_FAILED });
    expect(html).toContain(REORDER_FAILED);
  });

  it('Move up swaps the folder with the one above and saves the new order', async () => {
    const reorderFolders = vi.fn(async (_ids: string[]) => {});
    store = { folders: [], reorderFolders };
    await renderScreen({ folders: [WORK, FAMILY] });
    handlers['Move Family up']?.();
    await flush();
    expect(reorderFolders).toHaveBeenCalledWith(['f2', 'f1']);
    expect(setCalls).not.toContain(REORDER_FAILED);
  });

  it('a failed reorder shows the fixed sentence', async () => {
    const reorderFolders = vi.fn(async (_ids: string[]) => {
      throw new Error('server said boom');
    });
    store = { folders: [], reorderFolders };
    await renderScreen({ folders: [WORK, FAMILY] });
    handlers['Move Family up']?.();
    await flush();
    expect(reorderFolders).toHaveBeenCalledWith(['f2', 'f1']);
    expect(setCalls).toContain(REORDER_FAILED);
    expect(setCalls).not.toContain('server said boom');
  });
});
