import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BlockedPerson } from '@/lib/contacts-api';
import { flushTasks as flush } from '@/test/wait';

// Settings → Blocked people. The screen body is the default export wrapped in
// `RequireAuth`. `renderToStaticMarkup` never runs effects, so the body state
// is forced through the `useState` mock in call order: the people list, the
// page status, then the error text. Every setter call is recorded in
// `setCalls`, so a failure message or an updater shows up even though no
// render happens after the press. The Button and Retry handlers are captured
// while rendering and called by the test.
const NONE = Symbol('none');

vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('lucide-react-native', () => ({
  Ban: 'Ban',
  ChevronLeft: 'ChevronLeft',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    accessibilityLabel,
    onPress,
    children,
  }: {
    accessibilityLabel?: string;
    onPress?: () => void;
    children?: React.ReactNode;
  }) => {
    if (accessibilityLabel !== undefined && onPress !== undefined) {
      handlers[accessibilityLabel] = onPress;
    }
    return createElement('Button', null, children);
  },
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => createElement('Card', null, children),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ children }: { children: React.ReactNode }) =>
    createElement('IconButton', null, children),
}));

vi.mock('@/components/ui/state-message', () => ({
  StateMessage: ({
    title,
    action,
  }: {
    title: string;
    action?: { label: string; accessibilityLabel?: string; onPress: () => void };
  }) => {
    if (action !== undefined) {
      handlers[action.accessibilityLabel ?? action.label] = action.onPress;
    }
    return createElement(
      'StateMessage',
      null,
      title,
      action !== undefined ? action.accessibilityLabel : null,
    );
  },
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
}));

vi.mock('@/lib/blocked-users', () => ({
  reloadBlockedJids: async () => {},
}));

const api = {
  listBlockedUsers: vi.fn(async (): Promise<BlockedPerson[]> => []),
  unblockUser: vi.fn(async () => ({ blocked: false })),
};

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api, scenario: null }),
}));

let handlers: Record<string, () => void> = {};
let forced: unknown[] = [];
let cursor = 0;
let setCalls: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      const index = cursor;
      cursor += 1;
      const value = index < forced.length && forced[index] !== NONE ? forced[index] : initial;
      return [
        value as T,
        ((next: unknown) => {
          setCalls.push(next);
        }) as Dispatch<SetStateAction<T>>,
      ];
    },
  };
});

const ANN: BlockedPerson = {
  userId: 'u-ann',
  name: 'Ann',
  handle: 'ann',
  image: null,
  jid: null,
};
const BOB: BlockedPerson = { userId: 'u-bob', name: 'Bob', handle: null, image: null, jid: null };

const UNBLOCK_FAILED = 'Could not unblock. Try again.';

async function renderScreen(input: {
  people?: BlockedPerson[];
  status?: 'loading' | 'ready' | 'error';
  error?: string;
}): Promise<string> {
  forced = [input.people ?? [], input.status ?? 'loading', input.error ?? ''];
  cursor = 0;
  setCalls = [];
  handlers = {};
  try {
    const module = await import('@/app/settings/blocked');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forced = [];
  }
}

// Lets the press handler's promise chain and any Effect run finish.
describe('BlockedScreen', () => {
  it('shows loading while the list loads', async () => {
    const html = await renderScreen({ status: 'loading' });
    expect(html).toContain('Loading blocked people…');
  });

  it('shows the load error with Retry', async () => {
    const html = await renderScreen({
      status: 'error',
      error: 'Could not load blocked people. Try again.',
    });
    expect(html).toContain('Could not load blocked people. Try again.');
    expect(html).toContain('Retry loading blocked people');
  });

  it('shows the empty state when nobody is blocked', async () => {
    const html = await renderScreen({ status: 'ready', people: [] });
    expect(html).toContain('You have not blocked anyone.');
  });

  it('lists each blocked person with an Unblock button', async () => {
    const html = await renderScreen({ status: 'ready', people: [ANN, BOB] });
    expect(html).toContain('Blocked people');
    expect(html).toContain('They are not told.');
    expect(html).toContain('Ann');
    expect(html).toContain('@ann');
    expect(html).toContain('Bob');
    expect(html).toContain('Unblock');
    expect(handlers['Unblock Ann']).toBeDefined();
    expect(handlers['Unblock Bob']).toBeDefined();
  });

  it('Unblock calls the API and drops the row', async () => {
    api.unblockUser.mockClear();
    await renderScreen({ status: 'ready', people: [ANN] });
    handlers['Unblock Ann']?.();
    await flush();
    expect(api.unblockUser).toHaveBeenCalledWith('u-ann');
    expect(setCalls).not.toContain(UNBLOCK_FAILED);
    const updater = setCalls.find((next) => typeof next === 'function') as
      ((rows: BlockedPerson[]) => BlockedPerson[]) | undefined;
    expect(updater?.([ANN, BOB])).toEqual([BOB]);
  });

  it('a failed Unblock keeps the row and shows a fixed sentence', async () => {
    api.unblockUser.mockClear();
    api.unblockUser.mockRejectedValueOnce(new Error('server said boom'));
    await renderScreen({ status: 'ready', people: [ANN] });
    handlers['Unblock Ann']?.();
    await flush();
    expect(api.unblockUser).toHaveBeenCalledWith('u-ann');
    expect(setCalls).toContain(UNBLOCK_FAILED);
    expect(setCalls).not.toContain('server said boom');
  });

  it('Retry reloads the blocked list', async () => {
    api.listBlockedUsers.mockClear();
    await renderScreen({ status: 'error', error: 'Could not load blocked people. Try again.' });
    handlers['Retry loading blocked people']?.();
    await flush();
    expect(api.listBlockedUsers).toHaveBeenCalled();
  });
});
