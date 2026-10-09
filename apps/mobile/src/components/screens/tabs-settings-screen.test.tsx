// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsTabScreen from '@/app/(tabs)/settings';

// The Settings tab is rendered through `react-dom/client` (jsdom). The profile
// card and the hub rows are small stand-ins that show their text and count and
// expose their press handlers as buttons.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const state = vi.hoisted(() => ({
  profileApi: { getMe: vi.fn() },
  contacts: { listContactRequests: vi.fn() },
  me: undefined as { id: string; name: string; email: string } | undefined,
  push: vi.fn(),
}));

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(effect, [effect]);
    },
    useRouter: () => ({ push: state.push, back: () => {} }),
  };
});

vi.mock('lucide-react-native', () => ({
  Ban: () => null,
  ChevronRight: () => null,
  FolderOpen: () => null,
  KeyRound: () => null,
  Plug: () => null,
  Server: () => null,
  ShieldCheck: () => null,
  Sticker: () => null,
  UserPlus: () => null,
  UserRound: () => null,
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    ActivityIndicator: () => h('span', null, 'spinner'),
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
    View: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/auth/RequireAuth', async () => {
  const { createElement: h } = await import('react');
  return {
    RequireAuth: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/auth/session', () => ({
  useAuthStore: (selector: (store: { me: unknown }) => unknown) => selector({ me: state.me }),
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: () => null,
}));

vi.mock('@/components/ui/card', async () => {
  const { createElement: h } = await import('react');
  return {
    Card: ({ children }: { children?: ReactNode }) => h('div', null, children),
    SectionLabel: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/components/ui/icon-tile', async () => {
  const { createElement: h } = await import('react');
  return {
    IconTile: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/components/ui/list-row', async () => {
  const { createElement: h } = await import('react');
  return {
    ListRow: ({ title, count, onPress }: { title: string; count?: number; onPress: () => void }) =>
      h(
        'button',
        { type: 'button', 'data-action': title, onClick: onPress },
        count === undefined ? title : `${title} count:${count}`,
      ),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement: h } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: state.contacts }),
}));

vi.mock('@/components/settings/screen-shell', async () => {
  const { createElement: h } = await import('react');
  return {
    SettingsScreenShell: ({ title, children }: { title: string; children?: ReactNode }) =>
      h('div', null, h('h1', null, title), children),
  };
});

vi.mock('@/components/settings/use-profile-api', () => ({
  useProfileApi: () => ({ api: state.profileApi }),
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: { dark: '#fff', light: '#000' },
  ICON: { dark: '#fff', light: '#000' },
  MUTED_FOREGROUND: { dark: '#999', light: '#666' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

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
  const node = createElement(SettingsTabScreen);
  await act(async () => {
    root?.render(node);
  });
  await settle();
}

function text(): string {
  return container?.textContent ?? '';
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
  state.me = { id: 'me-1', name: 'Ana Session', email: 'ana@x.test' };
  state.profileApi.getMe.mockResolvedValue({
    id: 'me-1',
    email: 'ana@x.test',
    name: 'Ana',
    handle: 'ana',
  });
  state.contacts.listContactRequests.mockResolvedValue({ incoming: [{}, {}], outgoing: [{}] });
});

describe('Settings tab', () => {
  it('shows a spinner while the profile loads', async () => {
    state.profileApi.getMe.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(text()).toContain('spinner');
    expect(text()).not.toContain('@ana');
  });

  it('shows the profile name and @handle once loaded', async () => {
    await mount();
    expect(text()).toContain('Ana');
    expect(text()).toContain('@ana');
    expect(text()).not.toContain('spinner');
  });

  it('falls back to the session name and email when the profile fails', async () => {
    state.profileApi.getMe.mockRejectedValue(new Error('offline'));
    await mount();
    expect(text()).toContain('Ana Session');
    expect(text()).toContain('ana@x.test');
  });

  it('counts incoming and outgoing contact requests on the requests row', async () => {
    await mount();
    expect(text()).toContain('Contact requests count:3');
  });

  it('shows no request count when the requests cannot load', async () => {
    state.contacts.listContactRequests.mockRejectedValue(new Error('offline'));
    await mount();
    expect(text()).toContain('Contact requests count:0');
  });

  it('opens the profile editor from the profile card', async () => {
    await mount();
    await press('Your profile');
    expect(state.push).toHaveBeenCalledWith('/settings/profile');
  });

  it('opens a hub row at its route', async () => {
    await mount();
    await press('Contact requests');
    expect(state.push).toHaveBeenCalledWith('/settings/requests');
  });
});
