// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import JoinRoute from '@/app/join/[token]';

// The join-by-link route is rendered with its native pieces mocked as DOM
// elements; the real `JoinLinkBody` and the pure join helpers run.
// `react-dom/client` ships no bundled types, so it is loaded through a typed
// require handle (same as `use-action.test.tsx`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const TOKEN = 'a'.repeat(64);

const h = vi.hoisted(() => ({
  previewJoinLink: vi.fn(),
  joinByLink: vi.fn(),
  router: { replace: vi.fn() },
  session: {
    status: 'user' as 'loading' | 'guest' | 'user',
    me: { name: 'Ada' } as { name: string } | null,
  },
  params: { token: undefined as string | undefined },
  chats: [] as { id: string; groupId?: string; topic?: { isGeneral?: boolean } }[],
}));

vi.mock('expo-router', async () => {
  const { createElement: el } = await import('react');
  return {
    Redirect: ({ href }: { href: string }) => el('div', { 'data-redirect': href }),
    useLocalSearchParams: () => h.params,
    useRouter: () => h.router,
  };
});
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
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
  };
});
vi.mock('@/auth/RequireAuth', () => ({ LoadingScreen: () => 'Loading screen' }));
vi.mock('@/auth/session', () => ({ useSession: () => h.session }));
vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ previewJoinLink: h.previewJoinLink, joinByLink: h.joinByLink }),
  useChatStoreApi: () => ({ getState: () => ({ chats: h.chats }) }),
}));
vi.mock('@/components/ui/text', async () => {
  const { createElement: el } = await import('react');
  return { Text: ({ children }: { children?: ReactNode }) => el('span', null, children) };
});
vi.mock('@/components/ui/text-field', () => ({ TextField: () => null }));
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

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  h.previewJoinLink.mockReset();
  h.joinByLink.mockReset();
  h.router.replace.mockReset();
  h.session.status = 'user';
  h.session.me = { name: 'Ada' };
  h.params.token = TOKEN;
  h.chats = [];
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
  await act(async () => root.render(createElement(JoinRoute)));
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

const preview = (overrides: Record<string, unknown> = {}) => ({
  groupTitle: 'Neighbors',
  memberCount: 6,
  alreadyMember: false,
  groupId: 'g-1',
  ...overrides,
});

describe('Join route (zilar://join/<token>)', () => {
  it('shows the loading screen while the session loads', async () => {
    h.session.status = 'loading';
    await mount();
    expect(text()).toBe('Loading screen');
  });

  it('sends a guest to sign in and back to the same raw param', async () => {
    h.session.status = 'guest';
    h.params.token = 'junk-token';
    await mount();
    expect(container.querySelector('[data-redirect]')?.getAttribute('data-redirect')).toBe(
      `/login?from=${encodeURIComponent('/join/junk-token')}`,
    );
  });

  it('sends a guest without a token back to the chats list after sign-in', async () => {
    h.session.status = 'guest';
    h.params.token = undefined;
    await mount();
    expect(container.querySelector('[data-redirect]')?.getAttribute('data-redirect')).toBe(
      `/login?from=${encodeURIComponent('/')}`,
    );
  });

  it('asks a user without a name to choose one first', async () => {
    h.session.me = { name: '  ' };
    await mount();
    expect(text()).toContain('You are invited');
    await press('Choose a name');
    expect(h.router.replace).toHaveBeenCalledWith(
      `/welcome/name?from=${encodeURIComponent(`/join/${TOKEN}`)}`,
    );
    expect(h.previewJoinLink).not.toHaveBeenCalled();
  });

  it('shows the dead-link card at once for a token that is not a link', async () => {
    h.params.token = 'not a token';
    await mount();
    expect(text()).toContain('This link does not work');
    expect(h.previewJoinLink).not.toHaveBeenCalled();
  });

  it('checks the link, then shows the group preview', async () => {
    let finish: (value: unknown) => void = () => {};
    h.previewJoinLink.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    expect(text()).toContain('Checking your invite link…');
    await act(async () => finish(preview()));
    await waitFor(() => expect(text()).toContain('Neighbors'));
    expect(h.previewJoinLink).toHaveBeenCalledWith(TOKEN);
    expect(text()).toContain('6 members');
    expect(labelled('Join the group').textContent).toBe('Join the group');
  });

  it('shows the neutral dead-link card for an invalid link', async () => {
    h.previewJoinLink.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    await mount();
    await waitFor(() => expect(text()).toContain('This link does not work'));
    expect(text()).not.toContain('gone');
    await press('Cancel');
    expect(h.router.replace).toHaveBeenCalledWith('/');
  });

  it('shows the offline card for an unreachable server and retries', async () => {
    h.previewJoinLink.mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 0, code: 'network_error' }),
    );
    await mount();
    await waitFor(() => expect(text()).toContain('Could not load the link'));
    h.previewJoinLink.mockResolvedValue(preview());
    await press('Retry loading the link');
    await waitFor(() => expect(text()).toContain('Neighbors'));
    expect(h.previewJoinLink).toHaveBeenCalledTimes(2);
  });

  it('shows the retry text for a rate limit', async () => {
    h.previewJoinLink.mockRejectedValue(
      Object.assign(new Error('x'), { status: 429, code: 'rate_limited' }),
    );
    await mount();
    await waitFor(() => expect(text()).toContain('Too many attempts. Try again later.'));
  });

  it('joins and opens the General topic of the group', async () => {
    h.previewJoinLink.mockResolvedValue(preview());
    await mount();
    await waitFor(() => expect(text()).toContain('Neighbors'));
    h.joinByLink.mockImplementation(() => {
      h.chats = [{ id: 'chat-1', groupId: 'g-1', topic: { isGeneral: true } }];
      return Promise.resolve({ groupId: 'g-1', alreadyMember: false });
    });
    await press('Join the group');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalled());
    expect(h.joinByLink).toHaveBeenCalledWith(TOKEN);
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'chat-1' },
    });
  });

  it('opens the group screen when only the group is in the list, else the chats list', async () => {
    h.previewJoinLink.mockResolvedValue(preview());
    await mount();
    await waitFor(() => expect(text()).toContain('Neighbors'));
    h.joinByLink.mockImplementation(() => {
      h.chats = [{ id: 'chat-2', groupId: 'g-1' }];
      return Promise.resolve({ groupId: 'g-1', alreadyMember: false });
    });
    await press('Join the group');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalled());
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/group/[id]',
      params: { id: 'g-1' },
    });
  });

  it('falls back to the chats list when the group is not in the list yet', async () => {
    h.previewJoinLink.mockResolvedValue(preview());
    await mount();
    await waitFor(() => expect(text()).toContain('Neighbors'));
    h.joinByLink.mockResolvedValue({ groupId: 'g-1', alreadyMember: false });
    await press('Join the group');
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/'));
  });

  it('opens a group the user is already in without using the link', async () => {
    h.previewJoinLink.mockResolvedValue(preview({ alreadyMember: true }));
    h.chats = [{ id: 'chat-1', groupId: 'g-1', topic: { isGeneral: true } }];
    await mount();
    await waitFor(() => expect(text()).toContain('You are already a member of this group.'));
    await press('Open the group');
    expect(h.joinByLink).not.toHaveBeenCalled();
    expect(h.router.replace).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'chat-1' },
    });
  });

  it('disables Join while it runs and ignores a second press', async () => {
    h.previewJoinLink.mockResolvedValue(preview());
    await mount();
    await waitFor(() => expect(text()).toContain('Neighbors'));
    let finish: (value: unknown) => void = () => {};
    h.joinByLink.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await press('Join the group');
    expect(labelled('Join the group').textContent).toBe('Joining…');
    expect((labelled('Join the group') as HTMLButtonElement).disabled).toBe(true);
    await press('Join the group');
    expect(h.joinByLink).toHaveBeenCalledTimes(1);
    await act(async () => finish({ groupId: 'g-1', alreadyMember: false }));
    await waitFor(() => expect(h.router.replace).toHaveBeenCalledTimes(1));
  });

  it('keeps the preview with a retry line when the join hits an unreachable server', async () => {
    h.previewJoinLink.mockResolvedValue(preview());
    await mount();
    await waitFor(() => expect(text()).toContain('Neighbors'));
    h.joinByLink.mockRejectedValueOnce(
      Object.assign(new Error('raw'), { status: 0, code: 'network_error' }),
    );
    await press('Join the group');
    await waitFor(() => expect(text()).toContain('Could not join the group. Try again.'));
    expect(text()).not.toContain('raw');
    expect((labelled('Join the group') as HTMLButtonElement).disabled).toBe(false);
    expect(h.router.replace).not.toHaveBeenCalled();
  });

  it('shows the neutral card when the join is refused', async () => {
    h.previewJoinLink.mockResolvedValue(preview());
    await mount();
    await waitFor(() => expect(text()).toContain('Neighbors'));
    h.joinByLink.mockRejectedValueOnce(Object.assign(new Error('full'), { status: 409 }));
    await press('Join the group');
    await waitFor(() => expect(text()).toContain('This link does not work'));
    expect(text()).not.toContain('full');
  });
});
