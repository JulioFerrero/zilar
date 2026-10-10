// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TabsLayout from '@/app/(tabs)/_layout';
import { settle } from '@/test/wait';

// The tabs layout is rendered through `react-dom/client` (jsdom). The floating
// bar is a spy that records the props the layout gives it, so the assertions
// are about the profile the layout loads on focus.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const state = vi.hoisted(() => {
  const getMe = vi.fn();
  return {
    getMe,
    // One api object for every render, as the real hook gives: the focus
    // callback depends on it.
    api: { getMe },
    sessionToken: vi.fn(),
    bar: vi.fn<(props: { profile?: unknown }) => ReactNode>(() => null),
  };
});

vi.mock('expo-router/ui', async () => {
  const { createElement: h } = await import('react');
  return {
    Tabs: ({ children }: { children?: ReactNode }) => h('div', null, children),
    TabSlot: () => null,
    TabList: ({ children }: { children?: ReactNode }) => h('div', null, children),
    TabTrigger: () => null,
  };
});

vi.mock('expo-router', async () => {
  const { useEffect: useEffectHook } = await import('react');
  return {
    // Runs the focus callback on mount and its cleanup on unmount.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffectHook(effect, [effect]);
    },
  };
});

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/components/nav/floating-tab-bar', () => ({
  FloatingTabBar: state.bar,
  FLOATING_TABS: [{ name: 'index', href: '/' }],
}));

vi.mock('@/components/settings/use-profile-api', () => ({
  useProfileApi: () => ({ api: state.api }),
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: state.sessionToken,
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (store: { chats: readonly unknown[] }) => unknown) =>
    selector({ chats: [] }),
}));

let root: { render(node: ReactNode): void; unmount(): void } | undefined;
let container: HTMLDivElement | undefined;

async function mount(): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const node = createElement(TabsLayout);
  await act(async () => {
    root?.render(node);
  });
  await settle();
}

/** The profile prop of the latest render of the floating bar. */
function lastProfile(): unknown {
  const calls = state.bar.mock.calls;
  const last = calls[calls.length - 1];
  return last?.[0].profile;
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
  state.getMe.mockResolvedValue({ id: 'me-1', email: 'a@x.test', name: 'Ana', handle: 'ana' });
  state.sessionToken.mockResolvedValue('tok-1');
});

describe('TabsLayout', () => {
  it('shows the bar with no profile before the profile loads', async () => {
    state.getMe.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(state.bar).toHaveBeenCalled();
    expect(lastProfile()).toBeUndefined();
  });

  it('gives the bar the user id, name, avatar and session token', async () => {
    state.getMe.mockResolvedValue({
      id: 'me-1',
      email: 'a@x.test',
      name: 'Ana',
      handle: 'ana',
      avatarUrl: '/api/avatars/me-1',
    });
    await mount();
    expect(lastProfile()).toEqual({
      id: 'me-1',
      name: 'Ana',
      avatarUrl: '/api/avatars/me-1',
      token: 'tok-1',
    });
  });

  it('leaves out the avatar and the token when there are none', async () => {
    state.sessionToken.mockResolvedValue(undefined);
    await mount();
    expect(lastProfile()).toEqual({ id: 'me-1', name: 'Ana' });
  });

  it('keeps no profile when the profile request fails', async () => {
    state.getMe.mockRejectedValue(new Error('offline'));
    await mount();
    expect(lastProfile()).toBeUndefined();
  });
});
