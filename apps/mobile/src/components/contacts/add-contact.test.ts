import { describe, expect, it } from 'vitest';

import {
  ContactsApiError,
  type ContactRequestView,
  type ContactsApi,
  type HandleProfile,
} from '../../lib/contacts-api';
import {
  NO_USER_MESSAGE,
  actOnProfileRequest,
  addContactHandle,
  addContactInitial,
  addContactLookupFailure,
  addContactSendFailure,
  resolveContactChat,
} from './add-contact';

const ADA: HandleProfile = {
  userId: 'u-ada',
  name: 'Ada',
  handle: 'ada',
  image: null,
  relation: 'request_received',
};

function pendingRow(id: string, userId: string): ContactRequestView {
  return {
    id,
    status: 'pending',
    createdAt: '2026-10-01T00:00:00Z',
    other: { userId, name: 'Ada', handle: 'ada', image: null },
  };
}

function stub(overrides: Partial<ContactsApi>): ContactsApi {
  const base: ContactsApi = {
    async lookupByHandle() {
      return ADA;
    },
    async sendContactRequest() {
      throw new Error('unused');
    },
    async listContactRequests() {
      return { incoming: [], outgoing: [] };
    },
    async acceptContactRequest() {
      throw new Error('unused');
    },
    async declineContactRequest() {
      throw new Error('unused');
    },
    async cancelContactRequest() {
      throw new Error('unused');
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

describe('add-contact input', () => {
  it('starts idle', () => {
    expect(addContactInitial()).toEqual({ state: 'idle' });
  });

  it('normalises the typed handle and returns null when it is empty', () => {
    expect(addContactHandle('  @Julio ')).toBe('julio');
    expect(addContactHandle('@  ')).toBeNull();
    expect(addContactHandle('')).toBeNull();
  });

  it('names the single plain line for an unknown user', () => {
    expect(NO_USER_MESSAGE).toBe('No user with that username');
  });
});

describe('addContactLookupFailure', () => {
  it('shows missing for an unknown handle (404)', () => {
    expect(addContactLookupFailure(new ContactsApiError(404, 'not_found', 'x'))).toEqual({
      state: 'missing',
    });
  });

  it('asks to wait when rate limited, by status or by code', () => {
    const message = 'Too many lookups — wait a little and try again.';
    expect(addContactLookupFailure(new ContactsApiError(429, 'x', 'raw'))).toEqual({
      state: 'error',
      message,
    });
    expect(addContactLookupFailure(new ContactsApiError(400, 'rate_limited', 'raw'))).toEqual({
      state: 'error',
      message,
    });
  });

  it('says the server cannot be reached for a network failure', () => {
    expect(addContactLookupFailure(new ContactsApiError(0, 'network_error', 'raw'))).toEqual({
      state: 'error',
      message: 'Could not reach the server. Try again.',
    });
  });

  it('never shows the server text for other failures', () => {
    const generic = { state: 'error', message: 'Could not look up that username. Try again.' };
    expect(addContactLookupFailure(new ContactsApiError(500, 'boom', 'raw server text'))).toEqual(
      generic,
    );
    expect(addContactLookupFailure(new Error('thrown'))).toEqual(generic);
  });
});

describe('addContactSendFailure', () => {
  it('maps each known code to its fixed sentence', () => {
    const cases: Array<[string, string]> = [
      ['already_contact', 'You are already contacts.'],
      ['request_exists', 'A request is already pending.'],
      ['blocked', 'Unblock this person first.'],
      ['too_many_requests', 'Too many pending requests — wait for some answers first.'],
      ['declined_recently', 'They declined recently — try again in a few days.'],
      ['rate_limited', 'Too many tries — wait a little and try again.'],
    ];
    for (const [code, text] of cases) {
      expect(addContactSendFailure(new ContactsApiError(409, code, 'raw'))).toBe(text);
    }
  });

  it('passes the server message through for an unknown code', () => {
    expect(addContactSendFailure(new ContactsApiError(400, 'bad', 'Handle is taken'))).toBe(
      'Handle is taken',
    );
  });

  it('uses the generic sentence for anything that is not an API error', () => {
    expect(addContactSendFailure(new Error('thrown'))).toBe(
      'Could not send the request. Try again.',
    );
  });
});

describe('actOnProfileRequest', () => {
  it('acts on the pending incoming row, then reloads the profile', async () => {
    const calls: string[] = [];
    const profiles: HandleProfile[] = [];
    let sentNone = 0;
    const api = stub({
      async listContactRequests() {
        calls.push('list');
        return { incoming: [pendingRow('r-1', 'u-ada')], outgoing: [] };
      },
      async lookupByHandle(handle) {
        calls.push(`lookup:${handle}`);
        return { ...ADA, relation: 'contact' };
      },
    });
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      async (id) => {
        calls.push(`work:${id}`);
      },
      (profile) => profiles.push(profile),
      () => {
        sentNone += 1;
      },
    );
    expect(calls).toEqual(['list', 'work:r-1', 'lookup:ada']);
    expect(profiles).toEqual([{ ...ADA, relation: 'contact' }]);
    expect(sentNone).toBe(1);
  });

  it('matches an outgoing row too', async () => {
    const seen: string[] = [];
    const api = stub({
      async listContactRequests() {
        return { incoming: [], outgoing: [pendingRow('r-out', 'u-ada')] };
      },
    });
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      async (id) => {
        seen.push(id);
      },
      () => {},
      () => {},
    );
    expect(seen).toEqual(['r-out']);
  });

  it('with no pending row, only reloads the profile', async () => {
    const seen: string[] = [];
    let worked = 0;
    const api = stub({
      async lookupByHandle(handle) {
        seen.push(`lookup:${handle}`);
        return ADA;
      },
    });
    const profiles: HandleProfile[] = [];
    let sentNone = 0;
    await actOnProfileRequest(
      api,
      { userId: 'u-ada', handle: 'ada' },
      async () => {
        worked += 1;
      },
      (profile) => profiles.push(profile),
      () => {
        sentNone += 1;
      },
    );
    expect(worked).toBe(0);
    expect(seen).toEqual(['lookup:ada']);
    expect(profiles).toEqual([ADA]);
    expect(sentNone).toBe(1);
  });

  it('a failed action rejects with the same error and leaves the card alone', async () => {
    const failure = new ContactsApiError(409, 'x', 'nope');
    const api = stub({
      async listContactRequests() {
        return { incoming: [pendingRow('r-1', 'u-ada')], outgoing: [] };
      },
    });
    const profiles: HandleProfile[] = [];
    let sentNone = 0;
    await expect(
      actOnProfileRequest(
        api,
        { userId: 'u-ada', handle: 'ada' },
        async () => {
          throw failure;
        },
        (profile) => profiles.push(profile),
        () => {
          sentNone += 1;
        },
      ),
    ).rejects.toBe(failure);
    expect(profiles).toEqual([]);
    expect(sentNone).toBe(0);
  });

  it('a failed list rejects before any action runs', async () => {
    const failure = new Error('offline');
    let worked = 0;
    const api = stub({
      async listContactRequests() {
        throw failure;
      },
    });
    await expect(
      actOnProfileRequest(
        api,
        { userId: 'u-ada', handle: 'ada' },
        async () => {
          worked += 1;
        },
        () => {},
        () => {},
      ),
    ).rejects.toBe(failure);
    expect(worked).toBe(0);
  });
});

describe('resolveContactChat', () => {
  it('is undefined without a domain', () => {
    expect(resolveContactChat([{ id: 'u-ada@zilar.test', kind: 'dm' }], 'u-ada', undefined)).toBe(
      undefined,
    );
  });

  it('returns the DM id only when that chat is already loaded', () => {
    const chats = [{ id: 'u-ada@zilar.test', kind: 'dm' }];
    expect(resolveContactChat(chats, 'u-ada', 'zilar.test')).toBe('u-ada@zilar.test');
    expect(resolveContactChat([], 'u-ada', 'zilar.test')).toBeUndefined();
  });
});
