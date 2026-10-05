import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockedPerson, ContactsApi } from './contacts-api';
import { blockedJidsSnapshot, reloadBlockedJids, resetBlockedJidsForTests } from './blocked-users';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

const BOB: BlockedPerson = {
  userId: 'u-bob',
  name: 'Bob',
  handle: 'bob_b',
  image: null,
  jid: 'Bob@zilar.test',
};

const ANA: BlockedPerson = {
  userId: 'u-ana',
  name: 'Ana',
  handle: null,
  image: null,
  jid: 'ana@zilar.test',
};

function stubApi(list: () => Promise<BlockedPerson[]>): ContactsApi {
  return {
    async lookupByHandle() {
      throw new Error('unused');
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
    listBlockedUsers: list,
  };
}

describe('blocked-users', () => {
  beforeEach(() => {
    resetBlockedJidsForTests();
  });

  it('loads lowercased localparts, skipping a missing jid', async () => {
    await reloadBlockedJids(stubApi(async () => [BOB, { ...ANA, jid: null }]));
    const snapshot = blockedJidsSnapshot();
    expect(snapshot.has('bob')).toBe(true);
    expect(snapshot.size).toBe(1);
  });

  it('keeps the last good set when a reload fails', async () => {
    await reloadBlockedJids(stubApi(async () => [BOB]));
    await reloadBlockedJids(
      stubApi(async () => {
        throw new Error('boom');
      }),
    );
    expect(blockedJidsSnapshot().has('bob')).toBe(true);
  });

  it('reloadBlockedJids replaces the set', async () => {
    await reloadBlockedJids(stubApi(async () => [BOB]));
    await reloadBlockedJids(stubApi(async () => [ANA]));
    const snapshot = blockedJidsSnapshot();
    expect(snapshot.has('ana')).toBe(true);
    expect(snapshot.has('bob')).toBe(false);
  });
});
