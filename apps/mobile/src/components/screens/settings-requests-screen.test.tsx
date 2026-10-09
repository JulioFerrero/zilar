import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ContactRequestView } from '@/lib/contacts-api';

// Settings → Contact requests. The screen body is the default export wrapped
// in `RequireAuth`. `renderToStaticMarkup` never runs effects, so the body
// state is forced through the `useState` mock in call order: incoming, outgoing,
// the page status, then the error text. Every setter call is recorded in
// `setCalls`, so a failure message or a list updater shows up after a press.
// The button and Retry handlers are captured while rendering.
const NONE = Symbol('none');

vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
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
  UserPlus: 'UserPlus',
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
  SectionLabel: ({ children }: { children: React.ReactNode }) =>
    createElement('SectionLabel', null, children),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ children }: { children: React.ReactNode }) =>
    createElement('IconButton', null, children),
}));

vi.mock('@/components/ui/icon-tile', () => ({
  IconTile: ({ children }: { children: React.ReactNode }) =>
    createElement('IconTile', null, children),
}));

vi.mock('@/components/ui/list-row', () => ({
  ListRow: ({ title, onPress }: { title: string; onPress?: () => void }) => {
    if (onPress !== undefined) {
      handlers[title] = onPress;
    }
    return createElement('ListRow', null, title);
  },
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
    return createElement('StateMessage', null, title);
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
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

const api = {
  listContactRequests: vi.fn(async () => ({ incoming: [], outgoing: [] })),
  acceptContactRequest: vi.fn(async () => ({ request: {} })),
  declineContactRequest: vi.fn(async () => ({ request: {} })),
  cancelContactRequest: vi.fn(async () => ({ request: {} })),
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

function request(id: string, name: string, handle: string | null): ContactRequestView {
  return {
    id,
    status: 'pending',
    createdAt: '2026-10-01T10:00:00.000Z',
    other: { userId: `u-${id}`, name, handle, image: null },
  } as ContactRequestView;
}

const INCOMING = request('r-in', 'Ann', 'ann');
const OUTGOING = request('r-out', 'Bob', null);

const LOAD_FAILED = 'Something went wrong. Try again.';

async function renderScreen(input: {
  incoming?: ContactRequestView[];
  outgoing?: ContactRequestView[];
  status?: 'loading' | 'ready' | 'error';
  error?: string;
}): Promise<string> {
  forced = [
    input.incoming ?? [],
    input.outgoing ?? [],
    input.status ?? 'loading',
    input.error ?? '',
  ];
  cursor = 0;
  setCalls = [];
  handlers = {};
  try {
    const module = await import('@/app/settings/requests');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forced = [];
  }
}

// Lets the press handler's promise chain and any Effect run finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RequestsScreen', () => {
  it('shows loading while the requests load', async () => {
    const html = await renderScreen({ status: 'loading' });
    expect(html).toContain('Loading requests…');
    expect(html).toContain('People who want to add you.');
  });

  it('shows the load error with Retry', async () => {
    const html = await renderScreen({ status: 'error', error: LOAD_FAILED });
    expect(html).toContain(LOAD_FAILED);
    expect(handlers['Retry loading requests']).toBeDefined();
  });

  it('shows the empty state with no pending requests', async () => {
    const html = await renderScreen({ status: 'ready' });
    expect(html).toContain('No pending requests.');
  });

  it('lists incoming requests with Accept and Decline, and the pending count', async () => {
    const html = await renderScreen({ status: 'ready', incoming: [INCOMING] });
    expect(html).toContain('Incoming');
    expect(html).toContain('1 pending');
    expect(html).toContain('Ann');
    expect(html).toContain('@ann');
    expect(handlers['Accept Ann']).toBeDefined();
    expect(handlers['Decline Ann']).toBeDefined();
  });

  it('lists outgoing requests with Cancel and the waiting line', async () => {
    const html = await renderScreen({ status: 'ready', outgoing: [OUTGOING] });
    expect(html).toContain('Sent');
    expect(html).toContain('Waiting for an answer');
    expect(html).toContain('Bob');
    expect(handlers['Cancel the request to Bob']).toBeDefined();
  });

  it('Accept calls the API and removes the row', async () => {
    api.acceptContactRequest.mockClear();
    await renderScreen({ status: 'ready', incoming: [INCOMING] });
    handlers['Accept Ann']?.();
    await flush();
    expect(api.acceptContactRequest).toHaveBeenCalledWith('r-in');
    expect(setCalls).not.toContain(LOAD_FAILED);
    const updater = setCalls.find((next) => typeof next === 'function') as
      ((rows: ContactRequestView[]) => ContactRequestView[]) | undefined;
    expect(updater?.([INCOMING])).toEqual([]);
  });

  it('a failed Accept keeps the row and shows the fixed sentence', async () => {
    api.acceptContactRequest.mockClear();
    api.acceptContactRequest.mockRejectedValueOnce(new Error('server said boom'));
    await renderScreen({ status: 'ready', incoming: [INCOMING] });
    handlers['Accept Ann']?.();
    await flush();
    expect(api.acceptContactRequest).toHaveBeenCalledWith('r-in');
    expect(setCalls).toContain(LOAD_FAILED);
    expect(setCalls).not.toContain('server said boom');
  });

  it('Cancel calls the API for an outgoing request', async () => {
    api.cancelContactRequest.mockClear();
    await renderScreen({ status: 'ready', outgoing: [OUTGOING] });
    handlers['Cancel the request to Bob']?.();
    await flush();
    expect(api.cancelContactRequest).toHaveBeenCalledWith('r-out');
  });

  it('Retry reloads the requests', async () => {
    api.listContactRequests.mockClear();
    await renderScreen({ status: 'error', error: LOAD_FAILED });
    handlers['Retry loading requests']?.();
    await flush();
    expect(api.listContactRequests).toHaveBeenCalled();
  });
});
