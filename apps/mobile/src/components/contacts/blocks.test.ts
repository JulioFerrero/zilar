import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockedPerson, ContactsApi } from '../../lib/contacts-api';
import { blockedJidsSnapshot, resetBlockedJidsForTests } from '../../lib/blocked-users';
import { performBlock, performUnblock } from './blocks';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

const BOB: BlockedPerson = {
  userId: 'u-bob',
  name: 'Bob',
  handle: 'bob_b',
  image: null,
  jid: 'bob@zilar.test',
};

function stub(overrides: Partial<ContactsApi>): ContactsApi {
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

describe('blocks reload the blocked set', () => {
  beforeEach(() => {
    resetBlockedJidsForTests();
  });

  it('reloads after a successful block and runs onBlocked', async () => {
    let loaded = 0;
    let blocked = 0;
    const api = stub({
      async listBlockedUsers() {
        loaded += 1;
        return [BOB];
      },
    });
    const failure = await performBlock(api, 'u-bob', () => {
      blocked += 1;
    });
    expect(failure).toBeNull();
    expect(blocked).toBe(1);
    expect(loaded).toBe(1);
    expect(blockedJidsSnapshot().has('bob')).toBe(true);
  });

  it('reloads after a successful unblock and runs onUnblocked', async () => {
    let loaded = 0;
    let unblocked = 0;
    const api = stub({
      async listBlockedUsers() {
        loaded += 1;
        return [];
      },
    });
    const failure = await performUnblock(api, 'u-bob', () => {
      unblocked += 1;
    });
    expect(failure).toBeNull();
    expect(unblocked).toBe(1);
    expect(loaded).toBe(1);
  });

  it('does not reload when the block fails', async () => {
    let loaded = 0;
    const api = stub({
      async blockUser() {
        throw new Error('boom');
      },
      async listBlockedUsers() {
        loaded += 1;
        return [];
      },
    });
    expect(await performBlock(api, 'u-bob', () => {})).toBe('Could not block. Try again.');
    expect(loaded).toBe(0);
  });
});
