import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ChatFolder } from '@zilar/chat-core';
import { ChatFoldersApiError } from '@/lib/chat-folders-api';

// Settings → Chat folders → editor. The folder comes from the chat store (the
// selector is stubbed) and the route id from `useLocalSearchParams`. The form's
// own state is forced through the `useState` mock in call order: name, icon,
// the chat types, the two hide switches, busy, the error text, then the delete
// confirm. Every setter call is recorded in `setCalls`; the Save and Delete
// folder buttons are captured while rendering.
const NONE = Symbol('none');

const routerMock = { back: vi.fn(), push: vi.fn() };
let params: { id?: string } = { id: 'new' };

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  useRouter: () => routerMock,
}));

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/chat/folder-icon', () => ({
  folderIcon: () => 'FolderIcon',
}));

vi.mock('@/components/settings/screen-shell', () => ({
  SettingsScreenShell: ({
    title,
    right,
    children,
  }: {
    title: string;
    right?: React.ReactNode;
    children: React.ReactNode;
  }) => createElement('SettingsScreenShell', null, title, right, children),
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

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ label }: { label: string }) => createElement('Switch', null, label),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/lib/chat-folders-api', () => ({
  ChatFoldersApiError: class extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
}));

vi.mock('@/lib/depth', () => ({
  iconKey: {},
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' '),
}));

type StoreState = {
  folders: ChatFolder[];
  foldersLoaded: boolean;
  createFolder: (input: unknown) => Promise<void>;
  updateFolder: (id: string, input: unknown) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
};

let store: StoreState = {
  folders: [],
  foldersLoaded: true,
  createFolder: async () => {},
  updateFolder: async () => {},
  deleteFolder: async () => {},
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

const WORK: ChatFolder = {
  id: 'f1',
  name: 'Work',
  icon: 'folder',
  position: 0,
  includeTypes: ['dm'],
  includeChats: [],
  excludeChats: [],
  excludeMuted: false,
  excludeRead: false,
};

const SAVE_FAILED = 'Could not save the folder. Try again.';

async function renderScreen(input: {
  id: string;
  folders?: ChatFolder[];
  foldersLoaded?: boolean;
  name?: string;
  confirmingDelete?: boolean;
}): Promise<string> {
  params = { id: input.id };
  store = {
    ...store,
    folders: input.folders ?? [],
    foldersLoaded: input.foldersLoaded ?? true,
  };
  // Index 0 is the name, index 7 the delete confirm; the rest keep their initials.
  forced = Array.from({ length: 7 }, () => NONE);
  forced[0] = input.name ?? NONE;
  forced[6] = input.confirmingDelete ?? NONE;
  cursor = 0;
  setCalls = [];
  handlers = {};
  try {
    const module = await import('@/app/settings/folder/[id]');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forced = [];
  }
}

// Lets the press handler's promise chain and any Effect run finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FolderEditorScreen', () => {
  it('shows loading while an existing folder is not synced yet', async () => {
    const html = await renderScreen({ id: 'f1', folders: [], foldersLoaded: false });
    expect(html).toContain('Loading folder…');
  });

  it('shows the missing notice for a folder that is gone', async () => {
    const html = await renderScreen({ id: 'f9', folders: [WORK], foldersLoaded: true });
    expect(html).toContain('This folder no longer exists.');
  });

  it('shows the new folder form with Save and no delete', async () => {
    const html = await renderScreen({ id: 'new', name: 'Work' });
    expect(html).toContain('New folder');
    expect(html).toContain('Name and icon');
    expect(html).toContain('Show these chats');
    expect(html).toContain('Muted chats');
    expect(handlers['Save folder']).toBeDefined();
    expect(handlers['Delete folder']).toBeUndefined();
  });

  it('shows the edit form with Delete for an existing folder', async () => {
    const html = await renderScreen({ id: 'f1', folders: [WORK] });
    expect(html).toContain('Edit folder');
    expect(html).toContain('Delete folder');
    expect(handlers['Delete folder']).toBeDefined();
  });

  it('shows the delete confirm with the folder name', async () => {
    const html = await renderScreen({ id: 'f1', folders: [WORK], confirmingDelete: true });
    expect(html).toContain('Delete the folder Work? Chats stay where they are.');
  });

  it('Save creates the folder and goes back', async () => {
    const createFolder = vi.fn(async (_input: unknown) => {});
    routerMock.back.mockClear();
    store = { ...store, createFolder };
    await renderScreen({ id: 'new', name: 'Work' });
    handlers['Save folder']?.();
    await flush();
    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ name: 'Work' }));
    expect(routerMock.back).toHaveBeenCalled();
    expect(setCalls).not.toContain(SAVE_FAILED);
  });

  it('Save of an existing folder updates it', async () => {
    const updateFolder = vi.fn(async (_id: string, _input: unknown) => {});
    store = { ...store, updateFolder };
    await renderScreen({ id: 'f1', folders: [WORK] });
    handlers['Save folder']?.();
    await flush();
    expect(updateFolder).toHaveBeenCalledWith('f1', expect.objectContaining({ name: 'Work' }));
  });

  it('a folder limit error shows the limit sentence', async () => {
    const createFolder = vi.fn(async (_input: unknown) => {
      throw new ChatFoldersApiError(409, 'folder_limit', 'server text');
    });
    store = { ...store, createFolder };
    await renderScreen({ id: 'new', name: 'Work' });
    handlers['Save folder']?.();
    await flush();
    expect(setCalls).toContain('You can have up to 20 folders.');
  });

  it('any other failed save shows the fixed sentence', async () => {
    const createFolder = vi.fn(async (_input: unknown) => {
      throw new Error('server said boom');
    });
    store = { ...store, createFolder };
    await renderScreen({ id: 'new', name: 'Work' });
    handlers['Save folder']?.();
    await flush();
    expect(setCalls).toContain(SAVE_FAILED);
    expect(setCalls).not.toContain('server said boom');
  });
});
