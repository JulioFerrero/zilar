import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactsApiError, type ContactsApi, type HandleProfile } from '../../lib/contacts-api';
// The mobile app has no React Native testing library, so the row is
// rendered to a plain element tree with `react-native` stubbed (the
// `contacts.test.tsx` pattern). Top-level so vitest hoists them.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('lucide-react-native', () => ({
  Ban: 'Ban',
}));

vi.mock('../chat/avatar', () => ({
  Avatar: 'Avatar',
}));
import type { SearchScheduler } from '../chat/message-search';
import {
  PEOPLE_LOOKUP_ERROR_MESSAGE,
  PEOPLE_RATE_LIMITED_MESSAGE,
  PEOPLE_SEARCH_DEBOUNCE_MS,
  PeopleSearchController,
  peopleHandleFor,
} from './people-search';

interface ManualClock {
  frames: SearchScheduler;
  run: () => void;
  pending: () => number;
}

function manualClock(): ManualClock {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    frames: {
      setTimeout: (callback) => {
        const handle = next;
        next += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        callbacks.delete(handle as number);
      },
    },
    run: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) {
        callback();
      }
    },
    pending: () => callbacks.size,
  };
}

function person(overrides: Partial<HandleProfile> = {}): HandleProfile {
  return {
    userId: 'u-ada',
    name: 'Ada',
    handle: 'ada',
    image: null,
    relation: 'none',
    ...overrides,
  };
}

function fakeApi(respond: (handle: string) => Promise<HandleProfile>): {
  api: ContactsApi;
  calls: string[];
} {
  const calls: string[] = [];
  const api: ContactsApi = {
    async lookupByHandle(handle) {
      calls.push(handle);
      return respond(handle);
    },
    async sendContactRequest() {
      throw new ContactsApiError(409, 'request_exists', 'pending');
    },
    async listContactRequests() {
      return { incoming: [], outgoing: [] };
    },
    async acceptContactRequest() {
      throw new ContactsApiError(404, 'not_found', 'gone');
    },
    async declineContactRequest() {
      throw new ContactsApiError(404, 'not_found', 'gone');
    },
    async cancelContactRequest() {
      throw new ContactsApiError(404, 'not_found', 'gone');
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
  return { api, calls };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('peopleHandleFor', () => {
  it('uses the add-contact normalisation: strips @, trims, lowercases', () => {
    expect(peopleHandleFor('@Julio')).toBe('julio');
    expect(peopleHandleFor('  @julio  ')).toBe('julio');
  });

  it('returns null for anything that must not look up', () => {
    expect(peopleHandleFor('julio')).toBeNull();
    expect(peopleHandleFor('a message containing @julio')).toBeNull();
    expect(peopleHandleFor('@')).toBeNull();
    expect(peopleHandleFor('@  ')).toBeNull();
    expect(peopleHandleFor('')).toBeNull();
  });
});

describe('PeopleSearchController', () => {
  let clock: ManualClock;
  let changes = 0;

  beforeEach(() => {
    clock = manualClock();
    changes = 0;
  });

  function control(api: ContactsApi): PeopleSearchController {
    return new PeopleSearchController({
      api,
      onChange: () => {
        changes += 1;
      },
      frames: clock.frames,
    });
  }

  it('looks up only after 900 ms of no typing', async () => {
    const { api, calls } = fakeApi(async () => person());
    const controller = control(api);

    controller.setText('@ju');
    expect(controller.view.status).toBe('looking');
    expect(calls).toHaveLength(0);

    controller.setText('@jul');
    controller.setText('@juli');
    expect(clock.pending()).toBe(1);
    clock.run();
    await flush();

    expect(calls).toEqual(['juli']);
    expect(controller.view).toMatchObject({ status: 'found' });
  });

  it('waits PEOPLE_SEARCH_DEBOUNCE_MS of 900 ms', () => {
    expect(PEOPLE_SEARCH_DEBOUNCE_MS).toBe(900);
  });

  it('looks up at once on Enter', async () => {
    const { api, calls } = fakeApi(async () => person());
    const controller = control(api);

    controller.setText('@julio');
    expect(clock.pending()).toBe(1);
    controller.lookupNow();
    await flush();

    expect(calls).toEqual(['julio']);
    expect(clock.pending()).toBe(0);
    expect(controller.view).toMatchObject({ status: 'found' });
  });

  it('never looks up twice for the same handle in a row', async () => {
    const { api, calls } = fakeApi(async () => person());
    const controller = control(api);

    controller.setText('@julio');
    clock.run();
    await flush();
    expect(calls).toEqual(['julio']);

    controller.lookupNow();
    await flush();
    controller.setText('@julio ');
    await flush();
    expect(calls).toEqual(['julio']);
  });

  it('looks up again once the text changes to a different handle', async () => {
    const { api, calls } = fakeApi(async () => person());
    const controller = control(api);

    controller.setText('@julio');
    clock.run();
    await flush();
    controller.setText('@ada');
    clock.run();
    await flush();
    expect(calls).toEqual(['julio', 'ada']);
  });

  it('a text without @ never calls the lookup', async () => {
    const { api, calls } = fakeApi(async () => person());
    const controller = control(api);

    controller.setText('julio');
    controller.setText('a message containing @julio');
    controller.lookupNow();
    await flush();

    expect(calls).toHaveLength(0);
    expect(controller.view.status).toBe('idle');
  });

  it('shows the muted line for an unknown handle', async () => {
    const { api } = fakeApi(async () => {
      throw new ContactsApiError(404, 'not_found', 'No user with that username');
    });
    const controller = control(api);

    controller.setText('@nobody');
    clock.run();
    await flush();

    expect(controller.view.status).toBe('missing');
  });

  it('shows the rate-limited notice once and does not retry', async () => {
    const { api, calls } = fakeApi(async () => {
      throw new ContactsApiError(429, 'rate_limited', 'Too many attempts');
    });
    const controller = control(api);

    controller.setText('@julio');
    clock.run();
    await flush();

    expect(controller.view.status).toBe('rateLimited');
    expect(calls).toHaveLength(1);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('shows a fixed sentence for other failures, never the server message', async () => {
    const { api } = fakeApi(async () => {
      throw new ContactsApiError(500, 'internal_error', 'secret server detail');
    });
    const controller = control(api);

    controller.setText('@julio');
    clock.run();
    await flush();

    const view = controller.view;
    expect(view.status).toBe('error');
    if (view.status !== 'error') throw new Error('unreachable');
    expect(view.message).toBe(PEOPLE_LOOKUP_ERROR_MESSAGE);
    expect(view.message).not.toContain('secret server detail');
  });

  it('ignores a late answer after the text changed', async () => {
    let release!: (profile: HandleProfile) => void;
    const gate = new Promise<HandleProfile>((resolve) => {
      release = resolve;
    });
    let gated = true;
    const { api, calls } = fakeApi((handle) =>
      gated ? gate : Promise.resolve(person({ handle })),
    );
    const controller = control(api);

    controller.setText('@julio');
    clock.run();
    await flush();
    gated = false;
    controller.setText('@ada');
    clock.run();
    await flush();
    release(person({ handle: 'julio' }));
    await flush();

    expect(calls).toEqual(['julio', 'ada']);
    const view = controller.view;
    expect(view.status).toBe('found');
    if (view.status !== 'found') throw new Error('unreachable');
    expect(view.profile.handle).toBe('ada');
  });

  it('never calls the API after dispose', async () => {
    const { api, calls } = fakeApi(async () => person());
    const controller = control(api);

    controller.setText('@julio');
    controller.dispose();
    clock.run();
    await flush();

    expect(calls).toHaveLength(0);
    expect(changes).toBeGreaterThan(0);
  });

  it('never logs the typed text', async () => {
    const logged: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    try {
      const { api } = fakeApi(async () => person());
      const controller = control(api);
      controller.setText('@supersecrethandle');
      clock.run();
      await flush();
      expect(logged.join('\n')).not.toContain('supersecrethandle');
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  it('names the fixed sentences', () => {
    expect(PEOPLE_RATE_LIMITED_MESSAGE).toBe('Too many searches, try again in a few minutes.');
  });
});

describe('people row actions per relation', () => {
  // The mobile app has no React Native testing library, so the row is
  // rendered to a plain element tree with `react-native` stubbed (the
  // `contacts.test.tsx` pattern): this proves the search row reuses the
  // add-contact card, one action per relation.
  it('shows the right action for every relation', async () => {
    const { ProfileCardActionRow } = await import('./profile-card');

    interface Element {
      type: unknown;
      props: { children?: unknown; accessibilityLabel?: string };
    }
    const render = (props: unknown): unknown =>
      (ProfileCardActionRow as (input: unknown) => unknown)(props);
    const collect = (node: unknown, out: Element[] = []): Element[] => {
      if (Array.isArray(node)) {
        for (const child of node) collect(child, out);
        return out;
      }
      if (node === null || node === undefined || typeof node !== 'object') return out;
      const element = node as { type?: unknown; props?: { children?: unknown } };
      if (element.props === undefined) return out;
      if (typeof element.type === 'function') {
        return collect((element.type as (input: unknown) => unknown)(element.props), out);
      }
      out.push(element as Element);
      collect(element.props.children, out);
      return out;
    };
    const labels = (root: unknown): (string | undefined)[] =>
      collect(root)
        .filter((element) => element.type === 'Pressable')
        .map((element) => element.props.accessibilityLabel);
    const handlers = {
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

    const row = (relation: HandleProfile['relation'], sent = false, blockConfirming = false) =>
      render({ name: 'Ada', relation, sent, blockConfirming, busy: false, ...handlers });

    expect(labels(row('contact'))).toEqual(['Message', 'Block']);
    expect(labels(row('none'))).toEqual(['Send request', 'Block']);
    expect(labels(row('none', true))).toEqual(['Cancel the request', 'Block']);
    expect(labels(row('request_sent'))).toEqual(['Cancel the request', 'Block']);
    expect(labels(row('request_received'))).toEqual([
      'Accept',
      'Decline',
      'Open contact requests',
      'Block',
    ]);
    expect(labels(row('self'))).toEqual([]);
    expect(labels(row('blocked'))).toEqual(['Unblock']);
  });
});
