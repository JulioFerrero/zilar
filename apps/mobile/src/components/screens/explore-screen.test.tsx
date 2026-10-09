// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectoryApiError, type DirectoryEntry } from '@/lib/directory-api';
import ExploreScreen from '@/app/explore';

// The Explore route is rendered with its native pieces mocked as DOM
// elements, so the test drives the debounced search, paging and joins the way
// a user does. `react-dom/client` ships no bundled types, so it is loaded
// through a typed require handle (same as `use-action.test.tsx`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const h = vi.hoisted(() => ({
  api: { searchDirectory: vi.fn(), joinPublicGroup: vi.fn() },
  router: { back: vi.fn(), replace: vi.fn() },
  reloadChats: vi.fn(),
}));

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
    useRouter: () => h.router,
  };
});
vi.mock('nativewind', () => ({ useColorScheme: () => ({ colorScheme: 'dark' }) }));
vi.mock('lucide-react-native', () => ({ ChevronLeft: () => null, Compass: () => null }));
vi.mock('react-native-safe-area-context', async () => {
  const { createElement: el } = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) => el('div', null, children),
  };
});
vi.mock('react-native', async () => {
  const { createElement: el } = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => el('div', null, children),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) => el('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
    FlatList: ({
      data,
      renderItem,
      ListEmptyComponent,
      ListFooterComponent,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => ReactNode;
      ListEmptyComponent: ReactNode;
      ListFooterComponent: ReactNode;
    }) =>
      el(
        'div',
        null,
        data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) => el('div', { key: index }, renderItem({ item }))),
        ListFooterComponent,
      ),
  };
});
vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('@/components/chat/avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/directory/use-directory-api', () => ({
  useDirectoryApi: () => ({ api: h.api, scenario: null }),
}));
vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (select: (state: { reloadChats: () => void }) => unknown) =>
    select({ reloadChats: h.reloadChats }),
}));
vi.mock('@/components/ui/text', async () => {
  const { createElement: el } = await import('react');
  return { Text: ({ children }: { children?: ReactNode }) => el('span', null, children) };
});
vi.mock('@/components/ui/button', async () => {
  const { createElement: el } = await import('react');
  return {
    Button: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => el('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
  };
});
vi.mock('@/components/ui/icon-button', async () => {
  const { createElement: el } = await import('react');
  return {
    IconButton: ({
      children,
      onPress,
      label,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      label: string;
    }) => el('button', { onClick: onPress, 'aria-label': label }, children),
  };
});
vi.mock('@/components/ui/search-field', async () => {
  const { createElement: el } = await import('react');
  return {
    SearchField: ({
      value,
      onChangeText,
      accessibilityLabel,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      accessibilityLabel?: string;
    }) =>
      el('input', {
        value,
        'aria-label': accessibilityLabel,
        onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
      }),
  };
});
vi.mock('@/components/ui/state-message', async () => {
  const { createElement: el } = await import('react');
  return {
    StateMessage: ({
      kind,
      title,
      action,
    }: {
      kind: string;
      title: string;
      action?: { label: string; onPress: () => void };
    }) =>
      el(
        'div',
        { 'data-kind': kind },
        title,
        action === undefined
          ? null
          : el('button', { onClick: action.onPress, 'aria-label': action.label }, action.label),
      ),
  };
});

const entry = (id: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  id,
  kind: 'group',
  title: `Group ${id}`,
  handle: `group_${id}`,
  description: null,
  memberCount: 3,
  joined: false,
  ...overrides,
});

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.api.searchDirectory.mockReset();
  h.api.joinPublicGroup.mockReset();
  h.router.back.mockReset();
  h.router.replace.mockReset();
  h.reloadChats.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  unmount();
  container.remove();
});

const mount = async (): Promise<void> => {
  const root = createRoot(container);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(createElement(ExploreScreen)));
};

const waitFor = async (check: () => void, timeout = 3000): Promise<void> => {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started > timeout) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }
};

const labelled = (label: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`No element labelled ${label}`);
  }
  return found;
};

const press = (label: string): Promise<void> => act(async () => labelled(label).click());

const typeSearch = async (value: string): Promise<void> => {
  const input = labelled('Search public groups and channels') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const text = (): string => container.textContent ?? '';

describe('Explore screen', () => {
  it('shows the searching state, then the rows of the newest groups', async () => {
    h.api.searchDirectory.mockResolvedValue({
      entries: [
        entry('a', { description: 'Chess club', memberCount: 1 }),
        entry('b', { kind: 'channel', joined: true }),
      ],
      next: null,
    });
    await mount();
    expect(text()).toContain('Searching…');
    await waitFor(() => expect(text()).toContain('Group a'));
    expect(h.api.searchDirectory).toHaveBeenCalledWith({});
    expect(text()).toContain('@group_a');
    expect(text()).toContain('Chess club');
    expect(text()).toContain('1 member');
    expect(text()).toContain('3 members · Channel');
    expect(labelled('Join Group a').textContent).toBe('Join');
    expect(labelled('Open Group b').textContent).toBe('Open');
  });

  it('shows the empty line when nothing is public yet', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [], next: null });
    await mount();
    await waitFor(() =>
      expect(text()).toContain(
        'No public groups or channels yet. Be the first to make one public.',
      ),
    );
  });

  it('searches the typed text after the debounce and names it in the empty line', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [], next: null });
    await mount();
    await waitFor(() => expect(text()).toContain('No public groups'));
    await typeSearch('chess');
    await waitFor(() => expect(h.api.searchDirectory).toHaveBeenLastCalledWith({ q: 'chess' }));
    await waitFor(() =>
      expect(text()).toContain('Nothing public matches "chess". Try another name or @handle.'),
    );
  });

  it('does not search for a single typed character', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [entry('a')], next: null });
    await mount();
    await waitFor(() => expect(text()).toContain('Group a'));
    const calls = h.api.searchDirectory.mock.calls.length;
    await typeSearch('c');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(h.api.searchDirectory).toHaveBeenCalledTimes(calls);
    expect(text()).toContain('Group a');
  });

  it('filters by kind', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [], next: null });
    await mount();
    await waitFor(() => expect(h.api.searchDirectory).toHaveBeenCalled());
    await press('Channels');
    await waitFor(() =>
      expect(h.api.searchDirectory).toHaveBeenLastCalledWith({ kind: 'channel' }),
    );
  });

  it('shows a fixed line for a rate limit and retries from the button', async () => {
    h.api.searchDirectory.mockRejectedValueOnce(new DirectoryApiError(429, 'rate_limited', 'slow'));
    await mount();
    await waitFor(() => expect(text()).toContain('Too many searches, try again in a few minutes'));
    expect(text()).not.toContain('slow');
    h.api.searchDirectory.mockResolvedValue({ entries: [entry('a')], next: null });
    await press('Retry');
    await waitFor(() => expect(text()).toContain('Group a'));
  });

  it('never shows raw server text for another failure', async () => {
    h.api.searchDirectory.mockRejectedValue(new Error('db timeout on shard 3'));
    await mount();
    await waitFor(() => expect(text()).toContain('Could not load the directory. Try again.'));
    expect(text()).not.toContain('shard');
  });

  it('pages with Show more and appends the next rows', async () => {
    h.api.searchDirectory.mockResolvedValueOnce({ entries: [entry('a')], next: 'c1' });
    await mount();
    await waitFor(() => expect(text()).toContain('Group a'));
    h.api.searchDirectory.mockResolvedValueOnce({ entries: [entry('b')], next: null });
    await press('Show more');
    await waitFor(() => expect(text()).toContain('Group b'));
    expect(h.api.searchDirectory).toHaveBeenLastCalledWith({ cursor: 'c1' });
    expect(text()).toContain('Group a');
    expect(container.querySelector('[aria-label="Show more"]')).toBeNull();
  });

  it('shows a fixed line when paging fails', async () => {
    h.api.searchDirectory.mockResolvedValueOnce({ entries: [entry('a')], next: 'c1' });
    await mount();
    await waitFor(() => expect(text()).toContain('Group a'));
    h.api.searchDirectory.mockRejectedValueOnce(new Error('boom'));
    await press('Show more');
    await waitFor(() => expect(text()).toContain('Could not load more. Try again.'));
    expect(labelled('Show more').textContent).toBe('Show more');
  });

  it('joins a public group and opens it', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [entry('a')], next: null });
    await mount();
    await waitFor(() => expect(text()).toContain('Group a'));
    h.api.joinPublicGroup.mockResolvedValue({ groupId: 'g-1' });
    await press('Join Group a');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalled());
    expect(h.api.joinPublicGroup).toHaveBeenCalledWith('a');
    expect(h.reloadChats).toHaveBeenCalledTimes(1);
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/group/[id]',
      params: { id: 'g-1' },
    });
  });

  it('opens an already joined group without calling the join', async () => {
    h.api.searchDirectory.mockResolvedValue({
      entries: [entry('b', { joined: true })],
      next: null,
    });
    await mount();
    await waitFor(() => expect(text()).toContain('Group b'));
    await press('Open Group b');
    expect(h.api.joinPublicGroup).not.toHaveBeenCalled();
    expect(h.reloadChats).toHaveBeenCalledTimes(1);
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/group/[id]',
      params: { id: 'b' },
    });
  });

  it('shows the join row as busy while it runs and ignores a second press', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [entry('a'), entry('b')], next: null });
    await mount();
    await waitFor(() => expect(text()).toContain('Group b'));
    let finish: (value: { groupId: string }) => void = () => {};
    h.api.joinPublicGroup.mockReturnValue(
      new Promise<{ groupId: string }>((resolve) => {
        finish = resolve;
      }),
    );
    await press('Join Group a');
    expect(labelled('Join Group a').textContent).toBe('Joining…');
    expect((labelled('Join Group b') as HTMLButtonElement).disabled).toBe(true);
    await press('Join Group b');
    expect(h.api.joinPublicGroup).toHaveBeenCalledTimes(1);
    await act(async () => finish({ groupId: 'g-1' }));
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
  });

  it('shows a fixed line when the join fails and lets the user try again', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [entry('a')], next: null });
    await mount();
    await waitFor(() => expect(text()).toContain('Group a'));
    h.api.joinPublicGroup.mockRejectedValueOnce(new DirectoryApiError(409, 'group_full', 'x'));
    await press('Join Group a');
    await waitFor(() => expect(text()).toContain('That group is full right now.'));
    expect(h.router.replace).not.toHaveBeenCalled();
    expect(labelled('Join Group a').textContent).toBe('Join');
    h.api.joinPublicGroup.mockResolvedValue({ groupId: 'g-1' });
    await press('Join Group a');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
  });

  it('goes back from the header button', async () => {
    h.api.searchDirectory.mockResolvedValue({ entries: [], next: null });
    await mount();
    await press('Back');
    expect(h.router.back).toHaveBeenCalledTimes(1);
  });
});
