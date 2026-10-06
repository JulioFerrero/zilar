import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Machine } from '@/lib/machines-api';

// The screen body is the default export wrapped in `RequireAuth`; the inner
// list is not exported, so the test renders the default export with the auth
// guard and the data hooks stubbed. `renderToStaticMarkup` never runs
// effects, so each case forces the list state through the `useState` mock
// (the `AuthFlow.test.tsx` pattern): the first array `useState` is the
// machines rows, the first string state is the `status`
// ('loading' | 'ready' | 'error').
vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: () => Promise.resolve(),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
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
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  Copy: 'Copy',
  Plus: 'Plus',
  RefreshCw: 'RefreshCw',
  Server: 'Server',
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

vi.mock('@/components/machines/use-machines-api', () => ({
  useMachinesApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: { dark: '#ededed', light: '#ededed' },
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

const CREATED_AT = '2026-10-03T10:00:00.000Z';

function machine(overrides: Partial<Machine> & { id: string }): Machine {
  return {
    name: 'Machine',
    status: 'pending',
    os: 'macOS',
    osVersion: '15.0',
    arch: 'arm64',
    cpu: 'Apple M3',
    cores: 8,
    ramGb: 16,
    diskFreeGb: 120,
    drivers: [],
    fingerprint: 'fp',
    createdAt: CREATED_AT,
    approvedAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

const PENDING = machine({ id: 'm-pending', name: 'Laptop' });
const APPROVED = machine({ id: 'm-approved', name: 'Home server', status: 'approved' });
const REVOKED = machine({ id: 'm-revoked', name: 'Old box', status: 'revoked' });

let forcedArrays: Machine[][] = [];
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
  machines: Machine[];
  status: 'loading' | 'ready' | 'error';
  error?: string | undefined;
}): Promise<string> {
  forcedArrays = [input.machines];
  forcedStatus = input.status;
  forcedError = input.error;
  arrayCursor = 0;
  try {
    const module = await import('@/app/settings/machines');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedArrays = [];
    forcedStatus = 'loading';
    forcedError = undefined;
  }
}

describe('MachinesScreen', () => {
  it('shows loading while the list loads', async () => {
    const html = await renderScreen({ machines: [], status: 'loading' });
    expect(html).toContain('Loading machines');
  });

  it('shows the empty state with an add button', async () => {
    const html = await renderScreen({ machines: [], status: 'ready' });
    expect(html).toContain('No machines yet');
    expect(html).toContain('Add machine');
  });

  it('shows pending rows with Approve and Deny', async () => {
    const html = await renderScreen({ machines: [PENDING], status: 'ready' });
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('Laptop');
    expect(html).toContain('Approve');
    expect(html).toContain('Deny');
  });

  it('shows approved rows with Rename and Revoke', async () => {
    const html = await renderScreen({ machines: [APPROVED], status: 'ready' });
    expect(html).toContain('Your machines');
    expect(html).toContain('Home server');
    expect(html).toContain('Rename');
    expect(html).toContain('Revoke');
  });

  it('shows revoked rows behind the collapsed section with Delete', async () => {
    const html = await renderScreen({ machines: [REVOKED], status: 'ready' });
    expect(html).toContain('Revoked (1)');
    expect(html).not.toContain('Delete Old box');
  });

  it('shows the error state with Retry', async () => {
    const html = await renderScreen({
      machines: [],
      status: 'error',
      error: 'Could not reach the server.',
    });
    expect(html).toContain('Could not reach the server.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No machines yet');
  });
});
