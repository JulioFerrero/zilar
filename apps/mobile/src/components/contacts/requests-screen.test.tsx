import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContactsApiError, type ContactsApi, type ContactRequestView } from '@/lib/contacts-api';
import { performRequestAction } from './requests';

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

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('lucide-react-native', () => ({
  Ban: 'Ban',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
  UserPlus: 'UserPlus',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/lib/colors', () => ({
  DANGER: '#ef4444',
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
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

// A token-shaped secret the fake API below carries: no mapped message and
// no rendered tree may ever contain it.
const LEAKED_TOKEN = 'zilar-contact-token-9f8e7d6c5b4a';

let forcedArrays: ContactRequestView[][] = [];
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
      if (typeof initial === 'string' && initial === '' && forcedError !== undefined) {
        return [forcedError as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      return actual.useState(initial);
    },
  };
});

async function renderScreen(input: {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
  status: 'loading' | 'ready' | 'error';
  error?: string | undefined;
}): Promise<string> {
  forcedArrays = [input.incoming, input.outgoing];
  forcedStatus = input.status;
  forcedError = input.error;
  arrayCursor = 0;
  try {
    const module = await import('@/app/settings/requests');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedArrays = [];
    forcedStatus = 'loading';
    forcedError = undefined;
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
    expect(html).toContain('Blocked people');
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

  it('shows the error state with Retry', async () => {
    const html = await renderScreen({
      incoming: [],
      outgoing: [],
      status: 'error',
      error: 'Could not reach the server. Try again.',
    });
    expect(html).toContain('Could not reach the server. Try again.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No pending requests');
  });

  it('renders no token the API carries', async () => {
    const html = await renderScreen({
      incoming: [INCOMING],
      outgoing: [OUTGOING],
      status: 'ready',
    });
    expect(html).not.toContain(LEAKED_TOKEN);
  });
});

describe('performRequestAction', () => {
  function fakeApi(): ContactsApi & { calls: string[] } {
    const calls: string[] = [];
    const decided = (id: string, status: 'accepted' | 'declined' | 'cancelled') => ({
      request: {
        id,
        fromUserId: 'u-ada',
        toUserId: 'u-me',
        status,
        createdAt: '2026-10-03T10:00:00.000Z',
      },
    });
    return {
      calls,
      async lookupByHandle() {
        throw new ContactsApiError(404, 'not_found', 'No user with that username');
      },
      async sendContactRequest() {
        throw new ContactsApiError(409, 'request_exists', 'pending');
      },
      async listContactRequests() {
        return { incoming: [], outgoing: [] };
      },
      async acceptContactRequest(id) {
        calls.push(`accept:${id}`);
        return decided(id, 'accepted');
      },
      async declineContactRequest(id) {
        calls.push(`decline:${id}`);
        return decided(id, 'declined');
      },
      async cancelContactRequest(id) {
        calls.push(`cancel:${id}`);
        return decided(id, 'cancelled');
      },
      async blockUser(userId) {
        calls.push(`block:${userId}`);
        return { blocked: true };
      },
      async unblockUser(userId) {
        calls.push(`unblock:${userId}`);
        return { blocked: false };
      },
      async listBlockedUsers() {
        return [];
      },
    };
  }

  function lists() {
    let incoming = [INCOMING];
    let outgoing = [OUTGOING];
    return {
      remove: (id: string) => {
        incoming = incoming.filter((row) => row.id !== id);
        outgoing = outgoing.filter((row) => row.id !== id);
      },
      snapshot: () => ({ incoming, outgoing }),
    };
  }

  it('Accept calls the API once with the id and the row disappears', async () => {
    const api = fakeApi();
    const state = lists();
    const failure = await performRequestAction(api, 'req-dan', 'accept', state.remove);
    expect(failure).toBeNull();
    expect(api.calls).toEqual(['accept:req-dan']);
    expect(state.snapshot().incoming).toEqual([]);
    expect(state.snapshot().outgoing).toEqual([OUTGOING]);
  });

  it('Decline calls the API once with the id and the row disappears', async () => {
    const api = fakeApi();
    const state = lists();
    const failure = await performRequestAction(api, 'req-dan', 'decline', state.remove);
    expect(failure).toBeNull();
    expect(api.calls).toEqual(['decline:req-dan']);
    expect(state.snapshot().incoming).toEqual([]);
  });

  it('Cancel calls the API once with the id and the row disappears', async () => {
    const api = fakeApi();
    const state = lists();
    const failure = await performRequestAction(api, 'req-cara', 'cancel', state.remove);
    expect(failure).toBeNull();
    expect(api.calls).toEqual(['cancel:req-cara']);
    expect(state.snapshot().outgoing).toEqual([]);
  });

  it('keeps the row and returns the message on failure', async () => {
    const api = fakeApi();
    api.acceptContactRequest = async () => {
      throw new ContactsApiError(404, 'not_found', 'Not found');
    };
    const state = lists();
    const failure = await performRequestAction(api, 'req-dan', 'accept', state.remove);
    expect(failure).toBe('That request is no longer here.');
    expect(state.snapshot().incoming).toEqual([INCOMING]);
  });

  it('never echoes a token-bearing raw error into the failure message', async () => {
    const api = fakeApi();
    api.acceptContactRequest = async () => {
      throw new ContactsApiError(404, 'not_found', `Not found ${LEAKED_TOKEN}`);
    };
    const failure = await performRequestAction(api, 'req-dan', 'accept', () => {});
    expect(failure).toBe('That request is no longer here.');
    expect(failure ?? '').not.toContain(LEAKED_TOKEN);
  });
});
