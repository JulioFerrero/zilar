// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '@zilar/chat-core';

import ChatsScreen from '@/app/(tabs)/index';

// The Chats tab is rendered through `react-dom/client` (jsdom). The list rows,
// the action sheet and the banners are small stand-ins; the store is a plain
// object the test sets up, so each test drives one chat action.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const state = vi.hoisted(() => ({
  store: {
    chats: [] as ChatSummary[],
    chatsLoad: 'loaded' as 'loaded' | 'loading' | 'error',
    reloadChats: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    activeFolder: 'all',
    setActiveFolder: vi.fn(),
    folders: [] as unknown[],
    status: 'online',
    me: undefined as undefined,
    setChatPref: vi.fn(),
  },
  push: vi.fn(),
  sheet: vi.fn<(props: Record<string, unknown>) => ReactNode>(() => null),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: state.push, back: () => {} }),
  useLocalSearchParams: () => ({}),
}));

vi.mock('lucide-react-native', () => ({
  Archive: () => null,
  Search: () => null,
  X: () => null,
}));

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  type ListProps = {
    data: readonly unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
    ListEmptyComponent?: ReactNode;
  };
  return {
    FlatList: (props: ListProps) =>
      props.data.length === 0
        ? props.ListEmptyComponent
        : h(
            'div',
            null,
            props.data.map((item, index) =>
              h('div', { key: index }, props.renderItem({ item, index })),
            ),
          ),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) =>
      h(
        'button',
        { type: 'button', 'data-action': accessibilityLabel, onClick: onPress },
        children,
      ),
    RefreshControl: () => null,
    ScrollView: ({ children }: { children?: ReactNode }) => h('div', null, children),
    View: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const { createElement: h } = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/auth/RequireAuth', async () => {
  const { createElement: h } = await import('react');
  return {
    RequireAuth: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/components/chat/chat-actions-sheet', () => ({
  ChatActionsSheet: state.sheet,
}));

vi.mock('@/components/chat/chat-list-item', async () => {
  const { createElement: h } = await import('react');
  return {
    ChatListItem: ({
      chat,
      onPress,
      onLongPress,
    }: {
      chat: ChatSummary;
      onPress: () => void;
      onLongPress: () => void;
    }) =>
      h(
        'div',
        null,
        h(
          'button',
          { type: 'button', 'data-action': `chat:${chat.title}`, onClick: onPress },
          chat.title,
        ),
        h(
          'button',
          { type: 'button', 'data-action': `long:${chat.title}`, onClick: onLongPress },
          'hold',
        ),
      ),
  };
});

vi.mock('@/components/chat/group-list-item', () => ({
  GroupListItem: () => null,
}));

vi.mock('@/components/chat/folder-tabs', () => ({
  FolderTabs: () => null,
}));

vi.mock('@/components/chat/load-error', async () => {
  const { createElement: h } = await import('react');
  return {
    LoadError: ({ message, onRetry }: { message: string; onRetry: () => void }) =>
      h(
        'div',
        null,
        h('p', null, message),
        h('button', { type: 'button', 'data-action': 'load-retry', onClick: onRetry }),
      ),
    LoadErrorBanner: ({ message, onRetry }: { message: string; onRetry: () => void }) =>
      h(
        'div',
        null,
        h('p', null, message),
        h('button', { type: 'button', 'data-action': 'banner-retry', onClick: onRetry }),
      ),
  };
});

vi.mock('@/components/chat/message-search-list', () => ({
  MessageSearchList: () => null,
}));

vi.mock('@/components/chat/new-chat-button', () => ({
  NewChatButton: () => null,
}));

vi.mock('@/components/chat/skeleton', async () => {
  const { createElement: h } = await import('react');
  return {
    ChatListSkeleton: () => h('span', null, 'skeleton'),
  };
});

vi.mock('@/components/contacts/people-search', () => ({
  peopleHandleFor: () => null,
}));

vi.mock('@/components/contacts/people-search-result', () => ({
  PeopleSearchResult: () => null,
}));

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: {} }),
}));

vi.mock('@/components/ui/search-field', () => ({
  SearchField: () => null,
}));

vi.mock('@/components/ui/text', async () => {
  const { createElement: h } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/lib/colors', () => ({
  ICON: '#fff',
  MUTED_FOREGROUND: '#999',
}));

vi.mock('@/lib/connection', () => ({
  connectionLabel: () => undefined,
}));

vi.mock('@/lib/depth', () => ({
  well: {},
}));

vi.mock('@/lib/search-api', () => ({
  createSearchApi: () => ({}),
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: () => Promise.resolve(undefined),
}));

vi.mock('@/mock/search', () => ({
  createMockSearchApi: () => ({}),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (store: typeof state.store) => unknown) => selector(state.store),
}));

// The stand-in sheet: it shows the saving and error state and exposes each
// action the screen gives it. It is only open while a chat is chosen.
state.sheet.mockImplementation((props: Record<string, unknown>) => {
  if (props['chat'] === null) {
    return null;
  }
  const button = (action: string, onClick: unknown) =>
    createElement('button', {
      type: 'button',
      'data-action': action,
      onClick: onClick as () => void,
    });
  return createElement(
    'div',
    null,
    createElement('span', null, `busy:${String(props['busy'])}`),
    createElement('span', null, String(props['error'])),
    button('sheet-mute', () => (props['onMute'] as (duration: string) => void)('hour')),
    button('sheet-pin', props['onTogglePin']),
    button('sheet-archive', props['onToggleArchive']),
    button('sheet-close', props['onClose']),
  );
});

function chat(id: string, title: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...extra,
  };
}

let root: { render(node: ReactNode): void; unmount(): void } | undefined;
let container: HTMLDivElement | undefined;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const node = createElement(ChatsScreen);
  await act(async () => {
    root?.render(node);
  });
  await settle();
}

function text(): string {
  return container?.textContent ?? '';
}

function hasAction(name: string): boolean {
  return container?.querySelector(`[data-action="${name}"]`) !== null;
}

async function press(name: string): Promise<void> {
  const el = container?.querySelector<HTMLElement>(`[data-action="${name}"]`);
  if (el === null || el === undefined) {
    throw new Error(`no control named ${name}`);
  }
  await act(async () => {
    el.click();
  });
  await settle();
}

afterEach(async () => {
  if (root !== undefined) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  state.store.chats = [chat('c1', 'Ana'), chat('c2', 'Team')];
  state.store.chatsLoad = 'loaded';
  state.store.folders = [];
  state.store.activeFolder = 'all';
  state.store.setChatPref.mockResolvedValue(undefined);
});

describe('Chats tab', () => {
  it('lists the chats under the Chats title', async () => {
    await mount();
    expect(text()).toContain('Chats');
    expect(hasAction('chat:Ana')).toBe(true);
    expect(hasAction('chat:Team')).toBe(true);
  });

  it('shows the skeleton while the chats load', async () => {
    state.store.chats = [];
    state.store.chatsLoad = 'loading';
    await mount();
    expect(text()).toContain('skeleton');
  });

  it('shows the empty text when there are no chats', async () => {
    state.store.chats = [];
    await mount();
    expect(text()).toContain('No chats yet');
  });

  it('shows a banner over the list when a reload failed, and retries on request', async () => {
    state.store.chatsLoad = 'error';
    await mount();
    expect(text()).toContain("Couldn't load chats");
    await press('banner-retry');
    expect(state.store.reloadChats).toHaveBeenCalledTimes(1);
  });

  it('mutes a chat for an hour and closes the sheet once saved', async () => {
    await mount();
    await press('long:Ana');
    expect(hasAction('sheet-mute')).toBe(true);
    await press('sheet-mute');
    expect(state.store.setChatPref).toHaveBeenCalledWith('c1', {
      mutedUntil: expect.any(String),
    });
    expect(hasAction('sheet-mute')).toBe(false);
  });

  it('keeps the sheet open with the message when the change fails', async () => {
    state.store.setChatPref.mockRejectedValueOnce(new Error('offline'));
    await mount();
    await press('long:Ana');
    await press('sheet-mute');
    expect(text()).toContain('Could not save. Try again.');
    expect(text()).not.toContain('offline');
    expect(hasAction('sheet-mute')).toBe(true);
  });

  it('shows the busy state while a change is saving', async () => {
    state.store.setChatPref.mockReturnValueOnce(new Promise(() => {}));
    await mount();
    await press('long:Ana');
    await press('sheet-mute');
    expect(text()).toContain('busy:true');
  });

  it('pins an unpinned chat', async () => {
    await mount();
    await press('long:Ana');
    await press('sheet-pin');
    expect(state.store.setChatPref).toHaveBeenCalledWith('c1', { pinned: true });
  });

  it('archives a chat that is not archived', async () => {
    await mount();
    await press('long:Team');
    await press('sheet-archive');
    expect(state.store.setChatPref).toHaveBeenCalledWith('c2', { archived: true });
  });

  it('opens a chat from its row', async () => {
    await mount();
    await press('chat:Ana');
    expect(state.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'c1' } });
  });

  it('sends a second chat change while the first chat is still saving', async () => {
    state.store.setChatPref.mockReturnValueOnce(new Promise(() => {}));
    await mount();
    await press('long:Ana');
    await press('sheet-mute');
    await press('long:Team');
    await press('sheet-mute');
    expect(state.store.setChatPref).toHaveBeenCalledTimes(2);
    expect(state.store.setChatPref.mock.calls[0]?.[0]).toBe('c1');
    expect(state.store.setChatPref.mock.calls[1]?.[0]).toBe('c2');
  });

  it('drops a second tap on the same chat while its change is saving', async () => {
    state.store.setChatPref.mockReturnValueOnce(new Promise(() => {}));
    await mount();
    await press('long:Ana');
    await press('sheet-mute');
    await press('sheet-mute');
    expect(state.store.setChatPref).toHaveBeenCalledTimes(1);
  });
});
