// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectoryApiError, type DirectoryEntry } from '@/lib/directory-api';
import GroupHandleRoute from '@/app/at/[handle]';

// The `@handle` share entry is rendered with its native pieces mocked as DOM
// elements. `react-dom/client` ships no bundled types, so it is loaded
// through a typed require handle (same as `use-action.test.tsx`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const h = vi.hoisted(() => ({
  api: { lookupGroupByHandle: vi.fn(), joinPublicGroup: vi.fn() },
  router: { replace: vi.fn() },
  reloadChats: vi.fn(),
  session: { status: 'user' as 'loading' | 'guest' | 'user' },
  params: { handle: 'chess' as string | undefined },
}));

vi.mock('expo-router', async () => {
  const { createElement: el } = await import('react');
  return {
    Redirect: ({ href }: { href: string }) => el('div', { 'data-redirect': href }),
    useLocalSearchParams: () => h.params,
    useRouter: () => h.router,
  };
});
vi.mock('react-native', async () => {
  const { createElement: el } = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => el('div', null, children),
    ActivityIndicator: () => null,
  };
});
vi.mock('@/auth/RequireAuth', () => ({ LoadingScreen: () => 'Loading screen' }));
vi.mock('@/auth/session', () => ({ useSession: () => h.session }));
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

const entry = (overrides: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  id: 'g-1',
  kind: 'group',
  title: 'Chess club',
  handle: 'chess',
  description: 'We play chess',
  memberCount: 12,
  joined: false,
  ...overrides,
});

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.api.lookupGroupByHandle.mockReset();
  h.api.joinPublicGroup.mockReset();
  h.router.replace.mockReset();
  h.reloadChats.mockReset();
  h.session.status = 'user';
  h.params.handle = 'chess';
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
  await act(async () => root.render(createElement(GroupHandleRoute)));
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

const text = (): string => container.textContent ?? '';

describe('Group handle route (zilar://at/<handle>)', () => {
  it('shows the loading screen while the session loads', async () => {
    h.session.status = 'loading';
    await mount();
    expect(text()).toBe('Loading screen');
    expect(h.api.lookupGroupByHandle).not.toHaveBeenCalled();
  });

  it('sends a guest to sign in and back to the same handle', async () => {
    h.session.status = 'guest';
    await mount();
    expect(container.querySelector('[data-redirect]')?.getAttribute('data-redirect')).toBe(
      `/login?from=${encodeURIComponent('/at/chess')}`,
    );
  });

  it('sends a guest without a handle back to explore', async () => {
    h.session.status = 'guest';
    h.params.handle = undefined;
    await mount();
    expect(container.querySelector('[data-redirect]')?.getAttribute('data-redirect')).toBe(
      `/login?from=${encodeURIComponent('/explore')}`,
    );
  });

  it('shows the not-found card at once for a missing handle', async () => {
    h.params.handle = undefined;
    await mount();
    expect(text()).toContain("Couldn't open this link");
    expect(text()).toContain("This link is for a group that doesn't exist or isn't public.");
    expect(h.api.lookupGroupByHandle).not.toHaveBeenCalled();
  });

  it('shows Opening… and then the group card', async () => {
    let finish: (value: DirectoryEntry) => void = () => {};
    h.api.lookupGroupByHandle.mockReturnValue(
      new Promise<DirectoryEntry>((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    expect(text()).toContain('Opening…');
    await waitFor(() => expect(h.api.lookupGroupByHandle).toHaveBeenCalled());
    expect(text()).toContain('Opening…');
    await act(async () => finish(entry()));
    await waitFor(() => expect(text()).toContain('Chess club'));
    expect(h.api.lookupGroupByHandle).toHaveBeenCalledWith('chess');
    expect(text()).toContain('@chess');
    expect(text()).toContain('We play chess');
    expect(text()).toContain('12 members');
    expect(labelled('Join the group').textContent).toBe('Join the group');
  });

  it('names the channel on the join button', async () => {
    h.api.lookupGroupByHandle.mockResolvedValue(entry({ kind: 'channel' }));
    await mount();
    await waitFor(() => expect(text()).toContain('Chess club'));
    expect(labelled('Join the channel').textContent).toBe('Join the channel');
  });

  it('reads a 404 as the neutral not-found card', async () => {
    h.api.lookupGroupByHandle.mockRejectedValue(new DirectoryApiError(404, 'not_found', 'nope'));
    await mount();
    await waitFor(() => expect(text()).toContain("Couldn't open this link"));
    expect(text()).toContain("This link is for a group that doesn't exist or isn't public.");
  });

  it('closes to the chats list', async () => {
    h.api.lookupGroupByHandle.mockRejectedValue(new DirectoryApiError(404, 'not_found', 'nope'));
    await mount();
    await waitFor(() => expect(text()).toContain("Couldn't open this link"));
    await press('Close');
    expect(h.router.replace).toHaveBeenCalledWith('/');
  });

  it('shows a fixed error with Retry for another failure, then the card on retry', async () => {
    h.api.lookupGroupByHandle.mockRejectedValueOnce(new Error('db timeout on shard 3'));
    await mount();
    await waitFor(() => expect(text()).toContain('Could not open that link. Try again.'));
    expect(text()).not.toContain('shard');
    h.api.lookupGroupByHandle.mockResolvedValue(entry());
    await press('Retry');
    await waitFor(() => expect(text()).toContain('Chess club'));
    expect(h.api.lookupGroupByHandle).toHaveBeenCalledTimes(2);
  });

  it('names an unreachable server in the error', async () => {
    h.api.lookupGroupByHandle.mockRejectedValue(new DirectoryApiError(0, 'network_error', 'x'));
    await mount();
    await waitFor(() =>
      expect(text()).toContain('Could not reach the server. Check your connection and try again.'),
    );
  });

  it('joins and opens the group from the id the server answered', async () => {
    h.api.lookupGroupByHandle.mockResolvedValue(entry());
    await mount();
    await waitFor(() => expect(text()).toContain('Chess club'));
    h.api.joinPublicGroup.mockResolvedValue({ groupId: 'g-9' });
    await press('Join the group');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalled());
    expect(h.api.joinPublicGroup).toHaveBeenCalledWith('g-1');
    expect(h.reloadChats).toHaveBeenCalledTimes(1);
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/group/[id]',
      params: { id: 'g-9' },
    });
  });

  it('opens a group that is already joined without calling the join', async () => {
    h.api.lookupGroupByHandle.mockResolvedValue(entry({ joined: true }));
    await mount();
    await waitFor(() => expect(text()).toContain('Chess club'));
    await press('Open');
    expect(h.api.joinPublicGroup).not.toHaveBeenCalled();
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/group/[id]',
      params: { id: 'g-1' },
    });
  });

  it('disables the join while it runs and ignores a second press', async () => {
    h.api.lookupGroupByHandle.mockResolvedValue(entry());
    await mount();
    await waitFor(() => expect(text()).toContain('Chess club'));
    let finish: (value: { groupId: string }) => void = () => {};
    h.api.joinPublicGroup.mockReturnValue(
      new Promise<{ groupId: string }>((resolve) => {
        finish = resolve;
      }),
    );
    await press('Join the group');
    expect(labelled('Join the group').textContent).toBe('Joining…');
    expect((labelled('Join the group') as HTMLButtonElement).disabled).toBe(true);
    await press('Join the group');
    expect(h.api.joinPublicGroup).toHaveBeenCalledTimes(1);
    await act(async () => finish({ groupId: 'g-9' }));
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
  });

  it('shows a fixed line when the join fails and lets the user try again', async () => {
    h.api.lookupGroupByHandle.mockResolvedValue(entry());
    await mount();
    await waitFor(() => expect(text()).toContain('Chess club'));
    h.api.joinPublicGroup.mockRejectedValueOnce(new DirectoryApiError(409, 'group_full', 'x'));
    await press('Join the group');
    await waitFor(() => expect(text()).toContain('That group is full right now.'));
    expect(h.router.replace).not.toHaveBeenCalled();
    expect((labelled('Join the group') as HTMLButtonElement).disabled).toBe(false);
    h.api.joinPublicGroup.mockResolvedValue({ groupId: 'g-9' });
    await press('Join the group');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
  });
});
