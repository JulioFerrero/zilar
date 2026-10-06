import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContactsApiError, type BlockedPerson, type ContactsApi } from '@/lib/contacts-api';
import { blockedLoadFailure, performUnblock } from './blocks';

// The screen body is the default export wrapped in `RequireAuth`; the inner
// list is not exported, so the test renders the default export with the auth
// guard and the data hooks stubbed. `renderToStaticMarkup` never runs
// effects, so each case forces the list state through the `useState` mock
// (the `requests-screen.test.tsx` pattern): the first array `useState` is the
// blocked rows, the first non-empty string state is `status`, the first empty
// string state is `error`.
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
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('lucide-react-native', () => ({
  Ban: 'Ban',
  ChevronLeft: 'ChevronLeft',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
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

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/lib/depth', () => ({
  avatarShade: () => ({ background: '#ededed', color: '#0a0a0a', ring: false }),
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/lib/colors', () => ({
  DANGER: '#ef4444',
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
  MUTED_FOREGROUND: { dark: '#a1a1a1', light: '#a1a1a1' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

const EVE: BlockedPerson = {
  userId: 'u-eve',
  name: 'Eve',
  handle: 'eve',
  image: null,
  jid: null,
};

const NO_HANDLE: BlockedPerson = {
  userId: 'u-anon',
  name: 'Anon',
  handle: null,
  image: null,
  jid: null,
};

let forcedPeople: BlockedPerson[] = [];
let forcedStatus: 'loading' | 'ready' | 'error' = 'loading';
let forcedError: string | undefined = undefined;
let arrayCursor = 0;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      if (Array.isArray(initial) && arrayCursor < 1) {
        arrayCursor += 1;
        return [forcedPeople as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (typeof initial === 'string' && initial !== '' && forcedStatus !== 'loading') {
        return [forcedStatus as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (typeof initial === 'string' && initial === '' && forcedError !== undefined) {
        return [forcedError as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      return actual.useState(initial);
    },
  };
});

async function renderScreen(input: {
  people: BlockedPerson[];
  status: 'loading' | 'ready' | 'error';
  error?: string | undefined;
}): Promise<string> {
  forcedPeople = input.people;
  forcedStatus = input.status;
  forcedError = input.error;
  arrayCursor = 0;
  try {
    const module = await import('@/app/settings/blocked');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedPeople = [];
    forcedStatus = 'loading';
    forcedError = undefined;
    arrayCursor = 0;
  }
}

describe('BlockedScreen', () => {
  it('shows loading while the list loads', async () => {
    const html = await renderScreen({ people: [], status: 'loading' });
    expect(html).toContain('Loading blocked people');
  });

  it('shows the empty state', async () => {
    const html = await renderScreen({ people: [], status: 'ready' });
    expect(html).toContain('You have not blocked anyone.');
    expect(html).not.toContain('Unblock');
  });

  it('lists blocked people with avatar, name and @handle, plus Unblock', async () => {
    const html = await renderScreen({ people: [EVE], status: 'ready' });
    expect(html).toContain('Eve');
    expect(html).toContain('@eve');
    expect(html).toContain('Unblock');
  });

  it('keeps the @ off a person with no handle', async () => {
    const html = await renderScreen({ people: [NO_HANDLE], status: 'ready' });
    expect(html).toContain('Anon');
    expect(html).not.toContain('@');
  });

  it('shows the load error with Retry', async () => {
    const html = await renderScreen({
      people: [],
      status: 'error',
      error: 'Could not load blocked people. Try again.',
    });
    expect(html).toContain('Could not load blocked people. Try again.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('You have not blocked anyone.');
  });

  it('shows the unblock failure sentence on a ready list', async () => {
    const html = await renderScreen({
      people: [EVE],
      status: 'ready',
      error: 'Could not unblock. Try again.',
    });
    expect(html).toContain('Could not unblock. Try again.');
    expect(html).toContain('Eve');
  });
});

describe('blockedLoadFailure', () => {
  it('maps a rate limit to the retry sentence', () => {
    expect(blockedLoadFailure(new ContactsApiError(429, 'rate_limited', 'slow'))).toBe(
      'Too many tries — wait a little and try again.',
    );
  });

  it('falls back to the load sentence', () => {
    expect(blockedLoadFailure(new Error('boom'))).toBe('Could not load blocked people. Try again.');
  });
});

describe('performUnblock', () => {
  function stub(overrides: Partial<ContactsApi>): ContactsApi {
    const base: ContactsApi = {
      async lookupByHandle() {
        throw new ContactsApiError(404, 'not_found', 'x');
      },
      async sendContactRequest() {
        throw new ContactsApiError(409, 'request_exists', 'x');
      },
      async listContactRequests() {
        return { incoming: [], outgoing: [] };
      },
      async acceptContactRequest() {
        throw new ContactsApiError(404, 'not_found', 'x');
      },
      async declineContactRequest() {
        throw new ContactsApiError(404, 'not_found', 'x');
      },
      async cancelContactRequest() {
        throw new ContactsApiError(404, 'not_found', 'x');
      },
      async blockUser() {
        return { blocked: true };
      },
      async unblockUser() {
        return { blocked: false };
      },
      async listBlockedUsers() {
        return [];
      },
    };
    return { ...base, ...overrides };
  }

  it('unblocks and removes the row on success', async () => {
    const calls: string[] = [];
    const removed: string[] = [];
    const api = stub({
      async unblockUser(userId) {
        calls.push(`unblock:${userId}`);
        return { blocked: false };
      },
    });
    const failure = await performUnblock(api, 'u-eve', () => removed.push('u-eve'));
    expect(failure).toBeNull();
    expect(calls).toEqual(['unblock:u-eve']);
    expect(removed).toEqual(['u-eve']);
  });

  it('keeps the row and returns the sentence on failure', async () => {
    const removed: string[] = [];
    const api = stub({
      async unblockUser() {
        throw new ContactsApiError(500, 'internal_error', 'boom');
      },
    });
    const failure = await performUnblock(api, 'u-eve', () => removed.push('u-eve'));
    expect(failure).toBe('Could not unblock. Try again.');
    expect(removed).toEqual([]);
  });

  it('maps a 429 to the retry sentence', async () => {
    const api = stub({
      async unblockUser() {
        throw new ContactsApiError(429, 'rate_limited', 'slow');
      },
    });
    expect(await performUnblock(api, 'u-eve', () => {})).toBe(
      'Too many tries — wait a little and try again.',
    );
  });
});
