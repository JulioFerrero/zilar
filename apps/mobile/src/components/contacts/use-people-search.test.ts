// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ContactsApiError,
  type ContactRequestRow,
  type ContactsApi,
  type HandleProfile,
} from '../../lib/contacts-api';
import { usePeopleSearch } from './use-people-search';

// blocks.ts reaches react-native through blocked-users (AppState), as in blocks.test.ts.
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

// `react-dom/client` ships no bundled types, so it is loaded through a typed
// require handle (the same pattern as use-action.test.tsx).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Options = Parameters<typeof usePeopleSearch>[0];
type Hook = ReturnType<typeof usePeopleSearch>;

const ADA: HandleProfile = {
  userId: 'u-ada',
  name: 'Ada',
  handle: 'ada',
  image: null,
  relation: 'none',
};

const ROW: ContactRequestRow = {
  id: 'r-1',
  fromUserId: 'u-ada',
  toUserId: 'u-me',
  status: 'pending',
  createdAt: '2026-10-01T00:00:00Z',
};

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

function mountSearch(initial: Options): {
  hook: () => Hook;
  update: (next: Partial<Options>) => void;
} {
  const slot: { result?: Hook } = {};
  const report = (value: Hook): void => {
    slot.result = value;
  };
  const Probe = (props: Options) => {
    report(usePeopleSearch(props));
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let props = initial;
  const draw = () => {
    root.render(createElement(Probe, props));
  };
  act(() => draw());
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    hook: () => {
      if (slot.result === undefined) {
        throw new Error('the hook was not rendered');
      }
      return slot.result;
    },
    update: (next) => {
      props = { ...props, ...next };
      act(() => draw());
    },
  };
}

function makeApi(overrides: Partial<ContactsApi> = {}): { api: ContactsApi; calls: string[] } {
  const calls: string[] = [];
  const base: ContactsApi = {
    async lookupByHandle(handle) {
      calls.push(`lookup:${handle}`);
      return ADA;
    },
    async sendContactRequest(handle) {
      calls.push(`send:${handle}`);
      return { request: ROW };
    },
    async listContactRequests() {
      calls.push('list');
      return { incoming: [], outgoing: [] };
    },
    async acceptContactRequest(id) {
      calls.push(`accept:${id}`);
      return { request: { ...ROW, status: 'accepted' } };
    },
    async declineContactRequest(id) {
      calls.push(`decline:${id}`);
      return { request: { ...ROW, status: 'declined' } };
    },
    async cancelContactRequest(id) {
      calls.push(`cancel:${id}`);
      return { request: { ...ROW, status: 'cancelled' } };
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
      calls.push('blocked-list');
      return [];
    },
  };
  return { api: { ...base, ...overrides }, calls };
}

// One macrotask: every promise that is already settled has run its callbacks.
const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function baseOptions(api: ContactsApi, overrides: Partial<Options> = {}): Options {
  return {
    api,
    text: '',
    chats: [],
    myJid: 'me@zilar.test',
    onMessage: () => {},
    ...overrides,
  };
}

describe('usePeopleSearch lookups', () => {
  it('looks up at once when Enter is pressed', async () => {
    const { api, calls } = makeApi();
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    expect(calls).toEqual(['lookup:ada']);
    expect(search.hook().view).toEqual({ status: 'found', profile: ADA, sent: false });
  });

  it('waits the debounce after typing before it looks up', async () => {
    const { api, calls } = makeApi();
    mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      await settle(800);
    });
    expect(calls).toEqual([]);
    await act(async () => {
      await settle(300);
    });
    expect(calls).toEqual(['lookup:ada']);
  });

  it('a text without @ never looks up', async () => {
    const { api, calls } = makeApi();
    const search = mountSearch(baseOptions(api, { text: 'ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    expect(calls).toEqual([]);
    expect(search.hook().view).toEqual({ status: 'idle' });
  });
});

describe('usePeopleSearch actions', () => {
  it('send asks for the contact and shows the request as sent', async () => {
    const { api, calls } = makeApi();
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().send();
      await settle();
    });
    expect(calls).toEqual(['lookup:ada', 'send:ada']);
    expect(search.hook().view).toEqual({ status: 'found', profile: ADA, sent: true });
    expect(search.hook().busy).toBe(false);
  });

  it('a second press while one action runs is dropped', async () => {
    const { api, calls } = makeApi();
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().send();
      search.hook().send();
      await settle();
    });
    expect(calls.filter((call) => call.startsWith('send:'))).toEqual(['send:ada']);
  });

  it('a failed send shows the send sentence and keeps the card', async () => {
    const { api } = makeApi({
      async sendContactRequest() {
        throw new ContactsApiError(409, 'request_exists', 'pending');
      },
    });
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().send();
      await settle();
    });
    expect(search.hook().actionError).toBe('A request is already pending.');
    expect(search.hook().view).toEqual({ status: 'found', profile: ADA, sent: false });
    expect(search.hook().busy).toBe(false);
  });

  it('accept acts on the pending row and reloads the profile lookup', async () => {
    let lookups = 0;
    const { api, calls } = makeApi({
      async lookupByHandle(handle) {
        calls.push(`lookup:${handle}`);
        lookups += 1;
        return lookups === 1
          ? { ...ADA, relation: 'request_received' }
          : { ...ADA, relation: 'contact' };
      },
      async listContactRequests() {
        calls.push('list');
        return { incoming: [{ ...pendingIncoming() }], outgoing: [] };
      },
    });
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().acceptRequest();
      await settle();
    });
    expect(calls).toEqual(['lookup:ada', 'list', 'accept:r-1', 'lookup:ada']);
    expect(search.hook().actionError).toBeNull();
    expect(search.hook().view).toMatchObject({ status: 'found', profile: { userId: 'u-ada' } });
  });

  it('accept shows the refreshed relation, not the one from before the action', async () => {
    let lookups = 0;
    const { api } = makeApi({
      async lookupByHandle() {
        lookups += 1;
        return lookups === 1
          ? { ...ADA, relation: 'request_received' }
          : { ...ADA, relation: 'contact' };
      },
      async listContactRequests() {
        return { incoming: [pendingIncoming()], outgoing: [] };
      },
    });
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().acceptRequest();
      await settle();
    });
    expect(search.hook().view).toEqual({
      status: 'found',
      profile: { ...ADA, relation: 'contact' },
      sent: false,
    });
  });

  it('an accept on a request that is gone says so', async () => {
    const { api } = makeApi({
      async listContactRequests() {
        return { incoming: [pendingIncoming()], outgoing: [] };
      },
      async acceptContactRequest() {
        throw new ContactsApiError(404, 'not_found', 'gone');
      },
    });
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().acceptRequest();
      await settle();
    });
    expect(search.hook().actionError).toBe('That request is no longer here.');
  });

  it('block marks the card blocked and reloads the blocked list', async () => {
    const { api, calls } = makeApi();
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().block();
      await settle();
    });
    expect(calls).toEqual(['lookup:ada', 'block:u-ada', 'blocked-list']);
    expect(search.hook().view).toMatchObject({ status: 'found', profile: { relation: 'blocked' } });
    expect(search.hook().actionError).toBeNull();
  });

  it('a failed block shows the block sentence and keeps the card', async () => {
    const { api } = makeApi({
      async blockUser() {
        throw new Error('socket closed');
      },
    });
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().block();
      await settle();
    });
    expect(search.hook().actionError).toBe('Could not block. Try again.');
    expect(search.hook().view).toMatchObject({ status: 'found', profile: { relation: 'none' } });
  });

  it('unblock sets the card back to no relation', async () => {
    const { api, calls } = makeApi({
      async lookupByHandle() {
        return { ...ADA, relation: 'blocked' };
      },
    });
    const search = mountSearch(baseOptions(api, { text: '@ada' }));
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().unblock();
      await settle();
    });
    expect(calls).toContain('unblock:u-ada');
    expect(search.hook().view).toMatchObject({ status: 'found', profile: { relation: 'none' } });
  });

  it('message without a loaded chat says how to fix it, with one it opens the chat', async () => {
    const { api } = makeApi();
    const opened: string[] = [];
    const search = mountSearch(
      baseOptions(api, { text: '@ada', onMessage: (id) => opened.push(id) }),
    );
    await act(async () => {
      search.hook().lookupNow();
      await settle();
    });
    await act(async () => {
      search.hook().openMessage();
    });
    expect(search.hook().actionError).toBe(
      'No chat with them yet. Pull to refresh the chats list.',
    );
    expect(opened).toEqual([]);

    search.update({ chats: [{ id: 'u-ada@zilar.test', kind: 'dm' }] });
    await act(async () => {
      search.hook().openMessage();
    });
    expect(opened).toEqual(['u-ada@zilar.test']);
  });
});

function pendingIncoming(): {
  id: string;
  status: 'pending';
  createdAt: string;
  other: { userId: string; name: string; handle: string; image: null };
} {
  return {
    id: ROW.id,
    status: 'pending',
    createdAt: ROW.createdAt,
    other: { userId: ADA.userId, name: ADA.name, handle: ADA.handle, image: null },
  };
}
