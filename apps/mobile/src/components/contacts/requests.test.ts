import { describe, expect, it } from 'vitest';

import { ContactsApiError, type ContactRequestRow, type ContactsApi } from '../../lib/contacts-api';
import { performRequestAction, requestsActionFailure, requestsLoadFailure } from './requests';

const ROW: ContactRequestRow = {
  id: 'r-1',
  fromUserId: 'u-ada',
  toUserId: 'u-me',
  status: 'pending',
  createdAt: '2026-10-01T00:00:00Z',
};

function fakeApi(overrides: Partial<ContactsApi> = {}): { api: ContactsApi; calls: string[] } {
  const calls: string[] = [];
  const base: ContactsApi = {
    async lookupByHandle() {
      throw new Error('unused');
    },
    async sendContactRequest() {
      throw new Error('unused');
    },
    async listContactRequests() {
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
  return { api: { ...base, ...overrides }, calls };
}

describe('requestsLoadFailure', () => {
  it('asks to wait when rate limited, by status or by code', () => {
    const message = 'Too many tries — wait a little and try again.';
    expect(requestsLoadFailure(new ContactsApiError(429, 'x', 'raw'))).toBe(message);
    expect(requestsLoadFailure(new ContactsApiError(500, 'rate_limited', 'raw'))).toBe(message);
  });

  it('says the server cannot be reached for a network failure', () => {
    expect(requestsLoadFailure(new ContactsApiError(0, 'network_error', 'raw'))).toBe(
      'Could not reach the server. Try again.',
    );
  });

  it('passes the API error message through for other API failures', () => {
    expect(requestsLoadFailure(new ContactsApiError(500, 'boom', 'Server is busy'))).toBe(
      'Server is busy',
    );
  });

  it('uses the generic sentence for anything else', () => {
    expect(requestsLoadFailure(new Error('thrown'))).toBe('Something went wrong. Try again.');
  });
});

describe('requestsActionFailure', () => {
  it('says the request is gone for a 404', () => {
    expect(requestsActionFailure(new ContactsApiError(404, 'not_found', 'gone'))).toBe(
      'That request is no longer here.',
    );
  });

  it('falls back to the load wording for other failures', () => {
    expect(requestsActionFailure(new ContactsApiError(0, 'network_error', 'raw'))).toBe(
      'Could not reach the server. Try again.',
    );
  });
});

describe('performRequestAction', () => {
  it('accept calls the accept API, removes the row and resolves null', async () => {
    const { api, calls } = fakeApi();
    const removed: string[] = [];
    const failure = await performRequestAction(api, 'r-1', 'accept', (id) => removed.push(id));
    expect(failure).toBeNull();
    expect(calls).toEqual(['accept:r-1']);
    expect(removed).toEqual(['r-1']);
  });

  it('decline calls the decline API and removes the row', async () => {
    const { api, calls } = fakeApi();
    const removed: string[] = [];
    expect(await performRequestAction(api, 'r-2', 'decline', (id) => removed.push(id))).toBeNull();
    expect(calls).toEqual(['decline:r-2']);
    expect(removed).toEqual(['r-2']);
  });

  it('cancel calls the cancel API and removes the row', async () => {
    const { api, calls } = fakeApi();
    const removed: string[] = [];
    expect(await performRequestAction(api, 'r-3', 'cancel', (id) => removed.push(id))).toBeNull();
    expect(calls).toEqual(['cancel:r-3']);
    expect(removed).toEqual(['r-3']);
  });

  it('keeps the row and resolves the inline message when the API fails', async () => {
    const { api } = fakeApi({
      async acceptContactRequest() {
        throw new ContactsApiError(404, 'not_found', 'gone');
      },
    });
    const removed: string[] = [];
    expect(await performRequestAction(api, 'r-1', 'accept', (id) => removed.push(id))).toBe(
      'That request is no longer here.',
    );
    expect(removed).toEqual([]);
  });

  it('shows the generic sentence for a non-API failure and keeps the row', async () => {
    const { api } = fakeApi({
      async declineContactRequest() {
        throw new Error('socket closed');
      },
    });
    const removed: string[] = [];
    expect(await performRequestAction(api, 'r-1', 'decline', (id) => removed.push(id))).toBe(
      'Something went wrong. Try again.',
    );
    expect(removed).toEqual([]);
  });

  it('a row removal that throws shows the failure message', async () => {
    const { api } = fakeApi();
    expect(
      await performRequestAction(api, 'r-1', 'cancel', () => {
        throw new ContactsApiError(0, 'network_error', 'raw');
      }),
    ).toBe('Could not reach the server. Try again.');
  });
});
