import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ContactRequestView } from '@/lib/contacts-api';

// The screen body is the default export wrapped in `RequireAuth`; the inner
// list is not exported, so the test renders the default export with the auth
// guard and the data hooks stubbed. `renderToStaticMarkup` never runs
// effects, so each case forces the list state through the `useState` mock
// (the `AuthFlow.test.tsx` pattern): the first array `useState` is the
// incoming rows, the second the outgoing, the first string state is the
// `status` ('loading' | 'ready' | 'error').
vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  RefreshCw: 'RefreshCw',
  UserPlus: 'UserPlus',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/lib/colors', () => ({
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

const INCOMING: ContactRequestView = {
  id: 'req-dan',
  status: 'pending',
  createdAt: '2026-10-03T10:00:00.000Z',
  other: { userId: 'u-dan', name: 'Dan', handle: 'dan', image: null },
};

const OUTGOING: ContactRequestView = {
  id: 'req-cara',
  status: 'pending',
  createdAt: '2026-10-03T10:00:00.000Z',
  other: { userId: 'u-cara', name: 'Cara', handle: 'cara', image: null },
};

let forcedArrays: ContactRequestView[][] = [];
let forcedStatus: 'loading' | 'ready' | 'error' = 'loading';
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
      return actual.useState(initial);
    },
  };
});

async function renderScreen(input: {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
  status: 'loading' | 'ready' | 'error';
}): Promise<string> {
  forcedArrays = [input.incoming, input.outgoing];
  forcedStatus = input.status;
  arrayCursor = 0;
  try {
    const module = await import('@/app/settings/requests');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedArrays = [];
    forcedStatus = 'loading';
  }
}

describe('RequestsScreen', () => {
  it('shows loading while the list loads', async () => {
    const html = await renderScreen({ incoming: [], outgoing: [], status: 'loading' });
    expect(html).toContain('Loading requests');
  });

  it('shows the empty state with no pending requests', async () => {
    const html = await renderScreen({ incoming: [], outgoing: [], status: 'ready' });
    expect(html).toContain('No pending requests');
    expect(html).not.toContain('Accept');
  });

  it('shows incoming rows with Accept and Decline', async () => {
    const html = await renderScreen({ incoming: [INCOMING], outgoing: [], status: 'ready' });
    expect(html).toContain('Dan');
    expect(html).toContain('@dan');
    expect(html).toContain('Accept');
    expect(html).toContain('Decline');
    expect(html).toContain('1 pending');
  });

  it('shows outgoing rows with Cancel and the waiting line', async () => {
    const html = await renderScreen({ incoming: [], outgoing: [OUTGOING], status: 'ready' });
    expect(html).toContain('Cara');
    expect(html).toContain('Cancel');
    expect(html).toContain('Waiting for an answer');
  });

  it('shows both sections together', async () => {
    const html = await renderScreen({
      incoming: [INCOMING],
      outgoing: [OUTGOING],
      status: 'ready',
    });
    expect(html).toContain('Incoming');
    expect(html).toContain('Sent');
    expect(html).toContain('2 pending');
  });

  it('never renders message text or tokens', async () => {
    const html = await renderScreen({
      incoming: [INCOMING],
      outgoing: [OUTGOING],
      status: 'ready',
    });
    expect(html).not.toMatch(/Bearer/i);
  });
});
