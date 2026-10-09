// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RootLayout from '@/app/_layout';

// The root layout is rendered through `react-dom/client` (jsdom) with the
// native modules stubbed: fonts, splash screen, navigation and the session
// store. The assertions are about what reaches those seams.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const state = vi.hoisted(() => ({
  fonts: { loaded: false, error: null as Error | null },
  bootstrap: vi.fn(() => Promise.resolve()),
  prevent: vi.fn(() => Promise.resolve()),
  hide: vi.fn(() => Promise.resolve()),
  setScheme: vi.fn(),
}));

vi.mock('@/lib/polyfills', () => ({}));
vi.mock('@/global.css', () => ({}));

vi.mock('@expo-google-fonts/geist', () => ({
  Geist_400Regular: 'geist-400',
  Geist_500Medium: 'geist-500',
  Geist_600SemiBold: 'geist-600',
}));

vi.mock('@expo-google-fonts/geist-mono', () => ({
  GeistMono_400Regular: 'mono-400',
  GeistMono_500Medium: 'mono-500',
}));

vi.mock('@rn-primitives/portal', () => ({
  PortalHost: () => null,
}));

vi.mock('expo-font', () => ({
  useFonts: () => [state.fonts.loaded, state.fonts.error],
}));

vi.mock('expo-router', async () => {
  const { createElement: h } = await import('react');
  return {
    Stack: () => h('div', { 'data-testid': 'stack' }),
    ErrorBoundary: () => null,
  };
});

vi.mock('expo-router/react-navigation', async () => {
  const { createElement: h } = await import('react');
  return {
    ThemeProvider: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: state.prevent,
  hideAsync: state.hide,
}));

vi.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

vi.mock('nativewind', () => ({
  colorScheme: { set: state.setScheme },
}));

vi.mock('react-native-gesture-handler', async () => {
  const { createElement: h } = await import('react');
  return {
    GestureHandlerRootView: ({ children }: { children?: ReactNode }) =>
      h('div', { 'data-testid': 'gesture' }, children),
  };
});

vi.mock('@/auth/session', () => ({
  useAuthStore: (selector: (store: { bootstrap: () => Promise<void> }) => unknown) =>
    selector({ bootstrap: state.bootstrap }),
}));

vi.mock('@/lib/effect/runtime', () => ({
  mobileRuntime: {},
}));

vi.mock('@/lib/theme', () => ({
  NAV_THEME: { dark: {} },
}));

vi.mock('@/store/chat-store-provider', () => ({
  ChatStoreProvider: ({ children }: { children?: ReactNode }) => children,
}));

// Captured at import time, before any test clears the mocks.
const preventedAtImport = state.prevent.mock.calls.length;

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
  const node = createElement(RootLayout);
  await act(async () => {
    root?.render(node);
  });
  await settle();
}

function hasStack(): boolean {
  return container?.querySelector('[data-testid="stack"]') !== null;
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
  state.fonts = { loaded: false, error: null };
});

describe('RootLayout', () => {
  it('keeps the splash screen up from the start of the app', () => {
    expect(preventedAtImport).toBe(1);
  });

  it('renders nothing while the fonts load', async () => {
    await mount();
    expect(hasStack()).toBe(false);
    expect(state.hide).not.toHaveBeenCalled();
    expect(state.bootstrap).not.toHaveBeenCalled();
  });

  it('shows the app, forces the dark scheme and hides the splash once the fonts load', async () => {
    state.fonts = { loaded: true, error: null };
    await mount();
    expect(hasStack()).toBe(true);
    expect(state.setScheme).toHaveBeenCalledWith('dark');
    expect(state.hide).toHaveBeenCalledTimes(1);
  });

  it('treats a font error as ready', async () => {
    state.fonts = { loaded: false, error: new Error('font failed') };
    await mount();
    expect(hasStack()).toBe(true);
    expect(state.hide).toHaveBeenCalledTimes(1);
  });

  it('restores the session once, after the app shows', async () => {
    state.fonts = { loaded: true, error: null };
    await mount();
    expect(state.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('still shows the app when hiding the splash fails', async () => {
    state.fonts = { loaded: true, error: null };
    state.hide.mockRejectedValueOnce(new Error('splash busy'));
    await mount();
    expect(hasStack()).toBe(true);
    expect(state.hide).toHaveBeenCalledTimes(1);
  });
});
