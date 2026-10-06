import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProviderConnection } from '@/lib/connections-api';

// The screen body is the default export wrapped in `RequireAuth`; the inner
// list is not exported, so the test renders the default export with the auth
// guard and the data hooks stubbed. `renderToStaticMarkup` never runs
// effects, so each case forces the list state through the `useState` mock
// (the `AuthFlow.test.tsx` pattern): the first array `useState` is the
// connections rows, the first string state is the `status`
// ('loading' | 'ready' | 'error').
//
// A token-shaped secret the fake connection below carries: no rendered tree
// may ever contain it, and the key field state is cleared right after saving
// (the write-only assertion lives with the API test's `buildCreateBody`, and
// the tree assertion below covers the render side).
const LEAKED_KEY = 'zilar-test-api-key-9f8e7d6c5b4a3f2e1d0c';

vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  CircleAlert: 'CircleAlert',
  Eye: 'Eye',
  EyeOff: 'EyeOff',
  Inbox: 'Inbox',
  KeyRound: 'KeyRound',
  Plus: 'Plus',
  Trash2: 'Trash2',
  Zap: 'Zap',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/components/connections/use-connections-api', () => ({
  useConnectionsApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: { dark: '#ededed', light: '#ededed' },
  ACCENT_FOREGROUND: { dark: '#0a0a0a', light: '#0a0a0a' },
  DANGER: '#ef4444',
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
  MUTED_FOREGROUND: { dark: '#a1a1a1', light: '#a1a1a1' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

const CREATED_AT = '2026-10-03T10:00:00.000Z';

const OPENAI: ProviderConnection = {
  id: 'conn-openai',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: CREATED_AT,
};

let forcedArrays: ProviderConnection[][] = [];
let forcedStatus: 'loading' | 'ready' | 'error' = 'loading';
let forcedError: string | undefined = undefined;
let arrayCursor = 0;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      if (Array.isArray(initial) && arrayCursor < forcedArrays.length) {
        const forced = forcedArrays[arrayCursor] as unknown as T;
        arrayCursor += 1;
        return [forced, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (typeof initial === 'string' && initial !== '' && forcedStatus !== 'loading') {
        return [forcedStatus as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (
        typeof initial === 'object' &&
        initial !== null &&
        'message' in initial &&
        forcedError !== undefined
      ) {
        return [
          { message: forcedError } as unknown as T,
          (() => {}) as Dispatch<SetStateAction<T>>,
        ];
      }
      return actual.useState(initial);
    },
  };
});

async function renderScreen(input: {
  connections: ProviderConnection[];
  status: 'loading' | 'ready' | 'error';
  error?: string | undefined;
}): Promise<string> {
  forcedArrays = [input.connections];
  forcedStatus = input.status;
  forcedError = input.error;
  arrayCursor = 0;
  try {
    const module = await import('@/app/settings/connections');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedArrays = [];
    forcedStatus = 'loading';
    forcedError = undefined;
  }
}

describe('ConnectionsScreen', () => {
  it('shows loading while the list loads', async () => {
    const html = await renderScreen({ connections: [], status: 'loading' });
    expect(html).toContain('Loading connections');
  });

  it('shows the empty state with an add button', async () => {
    const html = await renderScreen({ connections: [], status: 'ready' });
    expect(html).toContain('No provider connections yet');
    expect(html).toContain('Add a connection');
    expect(html).toMatch(/<Plus[^>]*color="#0a0a0a"/);
    expect(html).not.toContain('color="#fff"');
  });

  it('shows connection rows with the provider, label and status', async () => {
    const html = await renderScreen({ connections: [OPENAI], status: 'ready' });
    expect(html).toContain('OpenAI');
    expect(html).toContain('Work');
    expect(html).toContain('active');
  });

  it('shows the error state with Retry', async () => {
    const html = await renderScreen({
      connections: [],
      status: 'error',
      error: 'Could not reach the server.',
    });
    expect(html).toContain('Could not reach the server.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No provider connections yet');
  });

  it('never renders an API key the API carries', async () => {
    // The record the API hands over carries a key field; the screen must not print it.
    const carrying = { ...OPENAI, apiKey: LEAKED_KEY } as unknown as typeof OPENAI;
    const html = await renderScreen({ connections: [carrying], status: 'ready' });
    expect(html).toContain(OPENAI.label);
    expect(html).not.toContain(LEAKED_KEY);
  });
});
