import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ContactsApi, ContactRequestView, HandleProfile } from '@/lib/contacts-api';

import {
  actOnProfileRequest,
  addContactHandle,
  addContactLookupFailure,
  addContactSendFailure,
  resolveContactChat,
} from './add-contact';
import { performBlock } from './blocks';
import { requestsActionFailure, requestsLoadFailure } from './requests';
import { ContactsApiError } from '@/lib/contacts-api';
import { ProfileCard, ProfileCardActionRow, shouldResetBlockConfirm } from './profile-card';

// The mobile app has no React Native testing library, so the component is
// rendered to a plain element tree with `react-native` stubbed (the
// `markdown-text.test.tsx` pattern). This keeps the test in Node (no
// simulator, no new dependency) while still exercising the real component.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/lib/depth', () => ({
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
}));

vi.mock('lucide-react-native', () => ({
  Ban: 'Ban',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('../chat/avatar', () => ({
  Avatar: 'Avatar',
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; accessibilityLabel?: string; onPress?: () => void };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

function profile(overrides: Partial<HandleProfile> = {}): HandleProfile {
  return {
    userId: 'u-ada',
    name: 'Ada',
    handle: 'ada',
    image: null,
    relation: 'none',
    ...overrides,
  };
}

const HANDLERS = {
  onSend: () => {},
  onCancel: () => {},
  onAccept: () => {},
  onDecline: () => {},
  onMessage: () => {},
  onOpenRequests: () => {},
  onStartBlock: () => {},
  onCancelBlock: () => {},
  onBlock: () => {},
  onUnblock: () => {},
};

function rowFor(relation: HandleProfile['relation'], sent = false, blockConfirming = false) {
  return ProfileCardActionRow({
    name: 'Ada',
    relation,
    sent,
    busy: false,
    blockConfirming,
    ...HANDLERS,
  });
}

function labels(elements: TestElement[]): (string | undefined)[] {
  return elements
    .filter((element) => element.type === 'Pressable')
    .map((element) => element.props.accessibilityLabel);
}

describe('ProfileCardActionRow', () => {
  it('offers Send request for none', () => {
    const elements = collect(rowFor('none'));
    expect(labels(elements)).toContain('Send request');
    expect(textOf(elements)).toContain('Send request');
  });

  it('offers Cancel for request_sent', () => {
    const elements = collect(rowFor('request_sent'));
    expect(labels(elements)).toContain('Cancel the request');
    expect(textOf(elements)).toContain('Request sent');
    expect(labels(elements)).not.toContain('Send request');
  });

  it('offers Cancel for the just-sent state', () => {
    const elements = collect(rowFor('none', true));
    expect(labels(elements)).toContain('Cancel the request');
    expect(textOf(elements)).toContain('Request sent.');
  });

  it('offers Accept, Decline and Requests for request_received', () => {
    const elements = collect(rowFor('request_received'));
    expect(labels(elements)).toContain('Accept');
    expect(labels(elements)).toContain('Decline');
    expect(labels(elements)).toContain('Open contact requests');
  });

  it('offers Message for contact', () => {
    const elements = collect(rowFor('contact'));
    expect(labels(elements)).toContain('Message');
    expect(textOf(elements)).toContain('already contacts');
  });

  it('offers nothing actionable for self', () => {
    const elements = collect(rowFor('self'));
    expect(labels(elements)).toEqual([]);
    expect(textOf(elements)).toContain('That is you.');
  });

  it('shows Unblock and the blocked line for a blocked relation', () => {
    const elements = collect(rowFor('blocked'));
    expect(labels(elements)).toContain('Unblock');
    expect(textOf(elements)).toContain('You blocked this person.');
    expect(labels(elements)).not.toContain('Block');
  });

  it('offers Block for every other relation but not self or blocked', () => {
    for (const relation of ['none', 'contact', 'request_sent', 'request_received'] as const) {
      expect(labels(collect(rowFor(relation)))).toContain('Block');
    }
    expect(labels(collect(rowFor('self')))).not.toContain('Block');
    expect(labels(collect(rowFor('blocked')))).not.toContain('Block');
  });

  it('opens the inline confirm with the web sentence', () => {
    const elements = collect(rowFor('none', false, true));
    const all = textOf(elements);
    expect(all).toContain('Block Ada? They are not told.');
    expect(all).toContain("You won't see their contact requests.");
    expect(labels(elements)).toContain('Confirm block');
    expect(labels(elements)).toContain('Cancel the block');
    expect(labels(elements)).not.toContain('Block');
  });

  it('wires the Block button to open, and Confirm to block', () => {
    const start = vi.fn();
    const confirm = vi.fn();
    const closedElements = collect(
      ProfileCardActionRow({
        name: 'Ada',
        relation: 'none',
        sent: false,
        busy: false,
        blockConfirming: false,
        ...HANDLERS,
        onStartBlock: start,
      }),
    );
    const blockButton = closedElements.find(
      (element) => element.type === 'Pressable' && element.props.accessibilityLabel === 'Block',
    );
    blockButton?.props.onPress?.();
    expect(start).toHaveBeenCalledTimes(1);

    const openElements = collect(
      ProfileCardActionRow({
        name: 'Ada',
        relation: 'none',
        sent: false,
        busy: false,
        blockConfirming: true,
        ...HANDLERS,
        onBlock: confirm,
      }),
    );
    const confirmButton = openElements.find(
      (element) =>
        element.type === 'Pressable' && element.props.accessibilityLabel === 'Confirm block',
    );
    confirmButton?.props.onPress?.();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('renders the profile header through ProfileCard', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileCard, {
        profile: profile(),
        sent: false,
        busy: false,
        error: null,
        ...HANDLERS,
      }),
    );
    expect(html).toContain('Ada');
    expect(html).toContain('@ada');
    expect(html).toContain('Send request');
  });

  it('renders the inline error through ProfileCard', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileCard, {
        profile: profile(),
        sent: false,
        busy: false,
        error: 'Could not send the request. Try again.',
        ...HANDLERS,
      }),
    );
    expect(html).toContain('Could not send the request. Try again.');
  });

  it('drops the block confirm when the relation changes after block or unblock', () => {
    expect(shouldResetBlockConfirm({ userId: 'u-ada', relation: 'none' }, profile())).toBe(false);
    expect(
      shouldResetBlockConfirm(
        { userId: 'u-ada', relation: 'none' },
        profile({ relation: 'blocked' }),
      ),
    ).toBe(true);
    expect(
      shouldResetBlockConfirm(
        { userId: 'u-ada', relation: 'blocked' },
        profile({ relation: 'none' }),
      ),
    ).toBe(true);
  });

  it('drops the block confirm when a different person is shown', () => {
    expect(
      shouldResetBlockConfirm(
        { userId: 'u-ada', relation: 'none' },
        profile({ userId: 'u-bob', name: 'Bob', handle: 'bob' }),
      ),
    ).toBe(true);
  });
});

describe('add-contact helpers', () => {
  it('returns null for an empty field', () => {
    expect(addContactHandle('')).toBeNull();
    expect(addContactHandle('  @  ')).toBeNull();
    expect(addContactHandle('@Ada')).toBe('ada');
  });

  it('maps 404 to missing', () => {
    expect(addContactLookupFailure(new ContactsApiError(404, 'not_found', 'No user'))).toEqual({
      state: 'missing',
    });
  });

  it('maps 429 to the retry text', () => {
    expect(addContactLookupFailure(new ContactsApiError(429, 'rate_limited', 'slow'))).toEqual({
      state: 'error',
      message: 'Too many lookups — wait a little and try again.',
    });
  });

  it('maps a network failure to the offline text', () => {
    expect(addContactLookupFailure(new ContactsApiError(0, 'network_error', 'down'))).toEqual({
      state: 'error',
      message: 'Could not reach the server. Try again.',
    });
  });

  it('maps send codes to plain language', () => {
    expect(addContactSendFailure(new ContactsApiError(409, 'already_contact', 'x'))).toBe(
      'You are already contacts.',
    );
    expect(addContactSendFailure(new ContactsApiError(409, 'request_exists', 'x'))).toBe(
      'A request is already pending.',
    );
    expect(addContactSendFailure(new ContactsApiError(409, 'blocked', 'x'))).toBe(
      'Unblock this person first.',
    );
    expect(addContactSendFailure(new ContactsApiError(429, 'too_many_requests', 'x'))).toBe(
      'Too many pending requests — wait for some answers first.',
    );
    expect(addContactSendFailure(new ContactsApiError(429, 'declined_recently', 'x'))).toBe(
      'They declined recently — try again in a few days.',
    );
    expect(addContactSendFailure(new ContactsApiError(429, 'rate_limited', 'x'))).toBe(
      'Too many tries — wait a little and try again.',
    );
    expect(addContactSendFailure(new Error('boom'))).toBe('Could not send the request. Try again.');
  });
});

describe('resolveContactChat', () => {
  const chats = [
    { id: 'u-ada@zilar.test', kind: 'dm' },
    { id: 'team@rooms.zilar.test', kind: 'group' },
  ];

  it('resolves the loaded DM chat for the contact', () => {
    expect(resolveContactChat(chats, 'U-Ada', 'zilar.test')).toBe('u-ada@zilar.test');
  });

  it('returns undefined when the chat is not loaded, not a guessed id', () => {
    expect(resolveContactChat(chats, 'u-zed', 'zilar.test')).toBeUndefined();
    expect(resolveContactChat(chats, 'u-ada', undefined)).toBeUndefined();
  });
});

describe('requests helpers', () => {
  it('maps rate limits to the retry text', () => {
    expect(requestsLoadFailure(new ContactsApiError(429, 'rate_limited', 'slow'))).toBe(
      'Too many tries — wait a little and try again.',
    );
  });

  it('maps a network failure to the offline text', () => {
    expect(requestsLoadFailure(new ContactsApiError(0, 'network_error', 'down'))).toBe(
      'Could not reach the server. Try again.',
    );
  });

  it('maps an unknown request to the gone text', () => {
    expect(requestsActionFailure(new ContactsApiError(404, 'not_found', 'gone'))).toBe(
      'That request is no longer here.',
    );
  });

  it('falls back to a plain message', () => {
    expect(requestsLoadFailure(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});

describe('actOnProfileRequest', () => {
  // A fake API with mutable server state: the lookup answers the current
  // relation, the actions flip it. Both the sheet and the `u/[handle]`
  // screen run this helper inside their busy guard, so these cases prove the
  // card ends on the new relation without a second guarded reload.
  function fakeApi(initial: {
    relation: HandleProfile['relation'];
    incoming: ContactRequestView[];
    outgoing: ContactRequestView[];
  }): ContactsApi & { calls: string[] } {
    let relation = initial.relation;
    let incoming = initial.incoming.map((row) => ({ ...row }));
    let outgoing = initial.outgoing.map((row) => ({ ...row }));
    const calls: string[] = [];
    const profile = (): HandleProfile => ({
      userId: 'u-ada',
      name: 'Ada',
      handle: 'ada',
      image: null,
      relation,
    });
    return {
      calls,
      async lookupByHandle() {
        calls.push('lookup');
        return profile();
      },
      async sendContactRequest() {
        throw new ContactsApiError(409, 'request_exists', 'pending');
      },
      async listContactRequests() {
        calls.push('list');
        return {
          incoming: incoming.map((row) => ({ ...row })),
          outgoing: outgoing.map((row) => ({ ...row })),
        };
      },
      async acceptContactRequest(id) {
        calls.push(`accept:${id}`);
        incoming = incoming.filter((row) => row.id !== id);
        relation = 'contact';
        return {
          request: {
            id,
            fromUserId: 'u-ada',
            toUserId: 'u-me',
            status: 'accepted',
            createdAt: '2026-10-03T10:00:00.000Z',
          },
        };
      },
      async declineContactRequest(id) {
        calls.push(`decline:${id}`);
        incoming = incoming.filter((row) => row.id !== id);
        relation = 'none';
        return {
          request: {
            id,
            fromUserId: 'u-ada',
            toUserId: 'u-me',
            status: 'declined',
            createdAt: '2026-10-03T10:00:00.000Z',
          },
        };
      },
      async cancelContactRequest(id) {
        calls.push(`cancel:${id}`);
        outgoing = outgoing.filter((row) => row.id !== id);
        relation = 'none';
        return {
          request: {
            id,
            fromUserId: 'u-me',
            toUserId: 'u-ada',
            status: 'cancelled',
            createdAt: '2026-10-03T10:00:00.000Z',
          },
        };
      },
      async blockUser(userId) {
        calls.push(`block:${userId}`);
        relation = 'blocked';
        return { blocked: true };
      },
      async unblockUser(userId) {
        calls.push(`unblock:${userId}`);
        relation = 'none';
        return { blocked: false };
      },
      async listBlockedUsers() {
        return [];
      },
    };
  }

  function requestRow(id: string): ContactRequestView {
    return {
      id,
      status: 'pending',
      createdAt: '2026-10-03T10:00:00.000Z',
      other: { userId: 'u-ada', name: 'Ada', handle: 'ada', image: null },
    };
  }

  it('Cancel on request_sent ends with none (Send request)', async () => {
    const api = fakeApi({ relation: 'request_sent', incoming: [], outgoing: [requestRow('r1')] });
    const seen: HandleProfile[] = [];
    let sentCleared = 0;
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      (id) => api.cancelContactRequest(id),
      (found) => seen.push(found),
      () => {
        sentCleared += 1;
      },
    );
    expect(api.calls).toEqual(['list', 'cancel:r1', 'lookup']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.relation).toBe('none');
    expect(sentCleared).toBe(1);
  });

  it('Accept on request_received ends with contact (Message)', async () => {
    const api = fakeApi({
      relation: 'request_received',
      incoming: [requestRow('r2')],
      outgoing: [],
    });
    const seen: HandleProfile[] = [];
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      (id) => api.acceptContactRequest(id),
      (found) => seen.push(found),
      () => {},
    );
    expect(api.calls).toEqual(['list', 'accept:r2', 'lookup']);
    expect(seen[0]?.relation).toBe('contact');
  });

  it('Decline on request_received ends with none', async () => {
    const api = fakeApi({
      relation: 'request_received',
      incoming: [requestRow('r3')],
      outgoing: [],
    });
    const seen: HandleProfile[] = [];
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      (id) => api.declineContactRequest(id),
      (found) => seen.push(found),
      () => {},
    );
    expect(seen[0]?.relation).toBe('none');
  });

  it('re-reads the profile when the row is already gone', async () => {
    const api = fakeApi({ relation: 'none', incoming: [], outgoing: [] });
    const seen: HandleProfile[] = [];
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      (id) => api.cancelContactRequest(id),
      (found) => seen.push(found),
      () => {},
    );
    expect(api.calls).toEqual(['list', 'lookup']);
    expect(seen[0]?.relation).toBe('none');
  });
});

describe('performBlock', () => {
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

  it('calls blockUser and runs onBlocked on success', async () => {
    const calls: string[] = [];
    let blocked = 0;
    const api = stub({
      async blockUser(id) {
        calls.push(`block:${id}`);
        return { blocked: true };
      },
    });
    const failure = await performBlock(api, 'u-ada', () => {
      blocked += 1;
    });
    expect(failure).toBeNull();
    expect(calls).toEqual(['block:u-ada']);
    expect(blocked).toBe(1);
  });

  it('maps a 429 to the retry sentence and does not run onBlocked', async () => {
    let blocked = 0;
    const api = stub({
      async blockUser() {
        throw new ContactsApiError(429, 'rate_limited', 'slow');
      },
    });
    expect(
      await performBlock(api, 'u-ada', () => {
        blocked += 1;
      }),
    ).toBe('Too many tries — wait a little and try again.');
    expect(blocked).toBe(0);
  });

  it('maps anything else to the block sentence', async () => {
    const api = stub({
      async blockUser() {
        throw new Error('boom');
      },
    });
    expect(await performBlock(api, 'u-ada', () => {})).toBe('Could not block. Try again.');
  });
});
