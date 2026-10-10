// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactsApiError, type HandleProfile } from '@/lib/contacts-api';
import HandleScreen from '@/app/u/[handle]';
import { waitForAct as waitFor } from '@/test/wait';

// The `@handle` profile route is rendered with its native pieces mocked as
// DOM elements; the profile card is a stand-in with one button per callback.
// `react-dom/client` ships no bundled types, so it is loaded through a typed
// require handle (same as `use-action.test.tsx`).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const h = vi.hoisted(() => ({
  api: {
    lookupByHandle: vi.fn(),
    sendContactRequest: vi.fn(),
    cancelContactRequest: vi.fn(),
    acceptContactRequest: vi.fn(),
    declineContactRequest: vi.fn(),
    listContactRequests: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
  },
  router: { back: vi.fn(), push: vi.fn() },
  params: { handle: '@Ada' as string | undefined },
  chats: [] as { id: string }[],
  me: { jid: 'me@chat.test' } as { jid: string } | null,
  reloadBlockedJids: vi.fn(),
}));

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
    useLocalSearchParams: () => h.params,
    useRouter: () => h.router,
  };
});
vi.mock('lucide-react-native', () => ({ ChevronLeft: () => null }));
vi.mock('react-native', async () => {
  const { createElement: el } = await import('react');
  const box = ({ children }: { children?: ReactNode }) => el('div', null, children);
  return { View: box, ScrollView: box };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement: el } = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) => el('div', null, children),
  };
});
vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: h.api, scenario: null }),
}));
vi.mock('@/lib/blocked-users', () => ({ reloadBlockedJids: h.reloadBlockedJids }));
vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (select: (state: { chats: { id: string }[]; me: unknown }) => unknown) =>
    select({ chats: h.chats, me: h.me }),
}));
vi.mock('@/components/ui/text', async () => {
  const { createElement: el } = await import('react');
  return { Text: ({ children }: { children?: ReactNode }) => el('span', null, children) };
});
vi.mock('@/components/ui/icon-button', async () => {
  const { createElement: el } = await import('react');
  return {
    IconButton: ({
      children,
      onPress,
      label,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      label: string;
    }) => el('button', { onClick: onPress, 'aria-label': label }, children),
  };
});
vi.mock('@/components/ui/state-message', async () => {
  const { createElement: el } = await import('react');
  return {
    StateMessage: ({
      kind,
      title,
      action,
    }: {
      kind: string;
      title: string;
      action?: { label: string; onPress: () => void; accessibilityLabel?: string };
    }) =>
      el(
        'div',
        { 'data-kind': kind },
        title,
        action === undefined
          ? null
          : el(
              'button',
              { onClick: action.onPress, 'aria-label': action.accessibilityLabel ?? action.label },
              action.label,
            ),
      ),
  };
});
vi.mock('@/components/contacts/profile-card', async () => {
  const { createElement: el } = await import('react');
  type Props = {
    profile: { name: string; relation: string };
    sent: boolean;
    busy: boolean;
    error: string | null;
    onSend: () => void;
    onCancel: () => void;
    onAccept: () => void;
    onDecline: () => void;
    onMessage: () => void;
    onOpenRequests: () => void;
    onBlock: () => void;
    onUnblock: () => void;
  };
  const action = (label: string, onClick: () => void, busy: boolean) =>
    el('button', { key: label, onClick, disabled: busy, 'aria-label': label }, label);
  return {
    ProfileCard: (props: Props) =>
      el(
        'div',
        { 'data-busy': String(props.busy) },
        `Card ${props.profile.name} relation=${props.profile.relation} sent=${props.sent}`,
        props.error === null ? null : el('p', { role: 'alert' }, props.error),
        action('Send', props.onSend, props.busy),
        action('Cancel request', props.onCancel, props.busy),
        action('Accept', props.onAccept, props.busy),
        action('Decline', props.onDecline, props.busy),
        action('Message', props.onMessage, false),
        action('Requests', props.onOpenRequests, false),
        action('Block', props.onBlock, props.busy),
        action('Unblock', props.onUnblock, props.busy),
      ),
  };
});

const profile = (overrides: Partial<HandleProfile> = {}): HandleProfile => ({
  userId: 'u-1',
  name: 'Ada Lovelace',
  handle: 'ada',
  image: null,
  relation: 'none',
  ...overrides,
});

let container: HTMLDivElement;
let unmount: () => void;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  for (const fn of Object.values(h.api)) {
    fn.mockReset();
  }
  h.router.back.mockReset();
  h.router.push.mockReset();
  h.reloadBlockedJids.mockReset();
  h.reloadBlockedJids.mockResolvedValue(undefined);
  h.params.handle = '@Ada';
  h.chats = [];
  h.me = { jid: 'me@chat.test' };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  unmount();
  container.remove();
});

const mount = async (): Promise<void> => {
  const root = createRoot(container);
  unmount = () => act(() => root.unmount());
  await act(async () => root.render(createElement(HandleScreen)));
};

const labelled = (label: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (found === null) {
    throw new Error(`No element labelled ${label}`);
  }
  return found;
};

const press = (label: string): Promise<void> => act(async () => labelled(label).click());

const text = (): string => container.textContent ?? '';

const loaded = async (found: HandleProfile = profile()): Promise<void> => {
  h.api.lookupByHandle.mockResolvedValue(found);
  await mount();
  await waitFor(() => expect(text()).toContain(`Card ${found.name}`));
};

describe('Profile by handle route (/u/<handle>)', () => {
  it('shows Loading… and the raw handle, then the card for the normalized handle', async () => {
    let finish: (value: HandleProfile) => void = () => {};
    h.api.lookupByHandle.mockReturnValue(
      new Promise<HandleProfile>((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    expect(text()).toContain('Loading…');
    expect(text()).toContain('@@Ada');
    await act(async () => finish(profile()));
    await waitFor(() => expect(text()).toContain('Card Ada Lovelace relation=none sent=false'));
    expect(h.api.lookupByHandle).toHaveBeenCalledWith('ada');
    expect(text()).toContain('@ada');
  });

  it('shows the plain no-user line for an empty handle without calling the server', async () => {
    h.params.handle = undefined;
    await mount();
    expect(text()).toContain('No user with that username');
    expect(h.api.lookupByHandle).not.toHaveBeenCalled();
  });

  it('shows the plain no-user line for a 404', async () => {
    h.api.lookupByHandle.mockRejectedValue(new ContactsApiError(404, 'not_found', 'nope'));
    await mount();
    await waitFor(() => expect(text()).toContain('No user with that username'));
  });

  it('shows a fixed error with Retry, then the card on retry', async () => {
    h.api.lookupByHandle.mockRejectedValueOnce(new Error('db timeout on shard 3'));
    await mount();
    await waitFor(() => expect(text()).toContain('Could not look up that username. Try again.'));
    expect(text()).not.toContain('shard');
    h.api.lookupByHandle.mockResolvedValue(profile());
    await press('Retry loading the profile');
    await waitFor(() => expect(text()).toContain('Card Ada Lovelace'));
  });

  it('names a rate limit', async () => {
    h.api.lookupByHandle.mockRejectedValue(new ContactsApiError(429, 'rate_limited', 'slow'));
    await mount();
    await waitFor(() =>
      expect(text()).toContain('Too many lookups — wait a little and try again.'),
    );
  });

  it('goes back and opens the requests list', async () => {
    await loaded();
    await press('Back');
    expect(h.router.back).toHaveBeenCalledTimes(1);
    await press('Requests');
    expect(h.router.push).toHaveBeenCalledWith('/settings/requests');
  });

  it('sends a contact request and marks the card as sent', async () => {
    await loaded();
    h.api.sendContactRequest.mockResolvedValue({ id: 'r-1' });
    await press('Send');
    await waitFor(() => expect(text()).toContain('sent=true'));
    expect(h.api.sendContactRequest).toHaveBeenCalledWith('ada');
  });

  it('turns the card into a received request when they already asked', async () => {
    await loaded();
    h.api.sendContactRequest.mockResolvedValue({ id: 'r-1', incoming: true });
    await press('Send');
    await waitFor(() => expect(text()).toContain('relation=request_received sent=false'));
  });

  it('shows the card busy while a request is sent and drops a second press', async () => {
    await loaded();
    let finish: (value: { id: string }) => void = () => {};
    h.api.sendContactRequest.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        finish = resolve;
      }),
    );
    await press('Send');
    expect(container.querySelector('[data-busy="true"]')).not.toBeNull();
    await press('Send');
    expect(h.api.sendContactRequest).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: 'r-1' }));
    await waitFor(() => expect(container.querySelector('[data-busy="false"]')).not.toBeNull());
  });

  it('shows the message for a refused request and frees the card', async () => {
    await loaded();
    h.api.sendContactRequest.mockRejectedValue(new ContactsApiError(409, 'already_contact', 'x'));
    await press('Send');
    await waitFor(() => expect(text()).toContain('You are already contacts.'));
    expect(container.querySelector('[data-busy="false"]')).not.toBeNull();
  });

  it('shows a fixed line for a request failure that is not an API error', async () => {
    await loaded();
    h.api.sendContactRequest.mockRejectedValue(new Error('boom'));
    await press('Send');
    await waitFor(() => expect(text()).toContain('Could not send the request. Try again.'));
  });

  it('accepts the pending request and reloads the profile', async () => {
    await loaded(profile({ relation: 'request_received' }));
    h.api.listContactRequests.mockResolvedValue({
      incoming: [{ id: 'r-9', other: { userId: 'u-1' } }],
      outgoing: [],
    });
    h.api.acceptContactRequest.mockResolvedValue({});
    h.api.lookupByHandle.mockResolvedValue(profile({ relation: 'contact' }));
    await press('Accept');
    await waitFor(() => expect(text()).toContain('relation=contact'));
    expect(h.api.acceptContactRequest).toHaveBeenCalledWith('r-9');
  });

  it('cancels and declines through the same request row', async () => {
    await loaded(profile({ relation: 'request_sent' }));
    h.api.listContactRequests.mockResolvedValue({
      incoming: [],
      outgoing: [{ id: 'r-3', other: { userId: 'u-1' } }],
    });
    h.api.cancelContactRequest.mockResolvedValue({});
    h.api.declineContactRequest.mockResolvedValue({});
    h.api.lookupByHandle.mockResolvedValue(profile({ relation: 'none' }));
    await press('Cancel request');
    await waitFor(() => expect(text()).toContain('relation=none'));
    expect(h.api.cancelContactRequest).toHaveBeenCalledWith('r-3');
    await press('Decline');
    await waitFor(() => expect(h.api.declineContactRequest).toHaveBeenCalledWith('r-3'));
  });

  it('blocks, reloads the blocked list and shows the blocked relation', async () => {
    await loaded();
    h.api.blockUser.mockResolvedValue(undefined);
    await press('Block');
    await waitFor(() => expect(text()).toContain('relation=blocked'));
    expect(h.api.blockUser).toHaveBeenCalledWith('u-1');
    expect(h.reloadBlockedJids).toHaveBeenCalledTimes(1);
  });

  it('shows a fixed line when the block fails', async () => {
    await loaded();
    h.api.blockUser.mockRejectedValue(new Error('boom'));
    await press('Block');
    await waitFor(() => expect(text()).toContain('Could not block. Try again.'));
    expect(text()).toContain('relation=none');
  });

  it('unblocks and shows the none relation', async () => {
    await loaded(profile({ relation: 'blocked' }));
    h.api.unblockUser.mockResolvedValue(undefined);
    await press('Unblock');
    await waitFor(() => expect(text()).toContain('relation=none'));
    expect(h.api.unblockUser).toHaveBeenCalledWith('u-1');
  });

  it('shows a fixed line when the unblock fails', async () => {
    await loaded(profile({ relation: 'blocked' }));
    h.api.unblockUser.mockRejectedValue(new Error('boom'));
    await press('Unblock');
    await waitFor(() => expect(text()).toContain('Could not unblock. Try again.'));
  });

  it('opens the direct chat when it is loaded', async () => {
    h.chats = [{ id: 'u-1@chat.test' }];
    await loaded(profile({ relation: 'contact' }));
    await press('Message');
    expect(h.router.push).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'u-1@chat.test' },
    });
  });

  it('tells the user to refresh when the direct chat is not loaded', async () => {
    await loaded(profile({ relation: 'contact' }));
    await press('Message');
    expect(h.router.push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(text()).toContain('No chat with them yet. Pull to refresh the chats list.'),
    );
  });
});
