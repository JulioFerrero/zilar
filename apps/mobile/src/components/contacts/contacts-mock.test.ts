import { beforeEach, describe, expect, it } from 'vitest';

import { ContactsApiError } from '@/lib/contacts-api';

import { contactsMockScenario, createMockContactsApi, resetContactsMock } from './contacts-mock';

describe('contactsMockScenario', () => {
  it('returns null without a mock opt-in, and default for ?mock=1', () => {
    expect(contactsMockScenario({}, {}, true)).toBeNull();
    expect(contactsMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '1' }, {}, false)).toBe('default');
  });

  it('honors the route param only when allowed', () => {
    expect(contactsMockScenario({}, { mock: 'empty' }, true)).toBe('empty');
    expect(contactsMockScenario({}, { mock: 'empty' }, false)).toBeNull();
  });
});

describe('createMockContactsApi', () => {
  beforeEach(() => {
    resetContactsMock();
  });

  it('looks up each seeded relation and 404s an unknown handle', async () => {
    const api = createMockContactsApi();
    await expect(api.lookupByHandle('ada')).resolves.toMatchObject({ relation: 'none' });
    await expect(api.lookupByHandle('bob')).resolves.toMatchObject({ relation: 'contact' });
    await expect(api.lookupByHandle('cara')).resolves.toMatchObject({ relation: 'request_sent' });
    await expect(api.lookupByHandle('dan')).resolves.toMatchObject({
      relation: 'request_received',
    });
    await expect(api.lookupByHandle('nobody')).rejects.toMatchObject({ status: 404 });
  });

  it('sends a request, then accepts the incoming one as a contact', async () => {
    const api = createMockContactsApi();
    const created = await api.sendContactRequest('ada');
    expect(created.request.status).toBe('pending');
    expect(created.incoming).toBeUndefined();
    await expect(api.lookupByHandle('ada')).resolves.toMatchObject({ relation: 'request_sent' });

    const list = await api.listContactRequests();
    expect(list.outgoing.some((row) => row.other.handle === 'ada')).toBe(true);

    await api.acceptContactRequest('req-dan');
    await expect(api.lookupByHandle('dan')).resolves.toMatchObject({ relation: 'contact' });
    const after = await api.listContactRequests();
    expect(after.incoming).toEqual([]);
  });

  it('declines and cancels, and answers a reverse send with incoming', async () => {
    const api = createMockContactsApi();
    const reverse = await api.sendContactRequest('dan');
    expect(reverse.incoming).toBe(true);

    await api.declineContactRequest('req-dan');
    await expect(api.lookupByHandle('dan')).resolves.toMatchObject({ relation: 'none' });

    await api.cancelContactRequest('req-cara');
    await expect(api.lookupByHandle('cara')).resolves.toMatchObject({ relation: 'none' });
    const after = await api.listContactRequests();
    expect(after).toEqual({ incoming: [], outgoing: [] });
  });

  it('refuses a duplicate send and an accept on the wrong side', async () => {
    const api = createMockContactsApi();
    await expect(api.sendContactRequest('cara')).rejects.toMatchObject({ code: 'request_exists' });
    await expect(api.sendContactRequest('bob')).rejects.toMatchObject({
      code: 'already_contact',
    });
    await expect(api.acceptContactRequest('req-cara')).rejects.toMatchObject({ status: 404 });
    await expect(api.cancelContactRequest('req-dan')).rejects.toMatchObject({ status: 404 });
  });

  it('is empty in the empty scenario and fails in the error one', async () => {
    const empty = createMockContactsApi('empty');
    await expect(empty.listContactRequests()).resolves.toEqual({ incoming: [], outgoing: [] });
    await expect(empty.lookupByHandle('ada')).rejects.toMatchObject({ status: 404 });

    const failing = createMockContactsApi('error');
    await expect(failing.listContactRequests()).rejects.toBeInstanceOf(ContactsApiError);
  });
});
