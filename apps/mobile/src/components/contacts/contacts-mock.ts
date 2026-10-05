import {
  ContactsApiError,
  type BlockedPerson,
  type ContactRequestList,
  type ContactRequestView,
  type ContactsApi,
  type CreatedContactRequest,
  type HandleProfile,
} from '@/lib/contacts-api';

/**
 * Mock contacts API for `EXPO_PUBLIC_ZILAR_MOCK=1` or `?mock=<scenario>`.
 * It lives beside the hook (not in `src/mock/`) so T-0182 touches only its
 * allowed files; the pattern otherwise mirrors `mock/ais.ts`. The lookups
 * and the list mutate this state, so sending a request in mock mode makes
 * it appear in the requests screen without a server.
 */

export type ContactsMockScenario = 'default' | 'empty' | 'error';

const CREATED_AT = '2026-10-03T10:00:00.000Z';

const PROFILES: readonly HandleProfile[] = [
  { userId: 'u-ada', name: 'Ada', handle: 'ada', image: null, relation: 'none' },
  { userId: 'u-bob', name: 'Bob', handle: 'bob', image: null, relation: 'contact' },
  { userId: 'u-cara', name: 'Cara', handle: 'cara', image: null, relation: 'request_sent' },
  { userId: 'u-dan', name: 'Dan', handle: 'dan', image: null, relation: 'request_received' },
  { userId: 'u-eve', name: 'Eve', handle: 'eve', image: null, relation: 'blocked' },
];

const BLOCKED_SEED: BlockedPerson = {
  userId: 'u-eve',
  name: 'Eve',
  handle: 'eve',
  image: null,
  jid: null,
};

const INCOMING_SEED: ContactRequestView = {
  id: 'req-dan',
  status: 'pending',
  createdAt: CREATED_AT,
  other: { userId: 'u-dan', name: 'Dan', handle: 'dan', image: null },
};

const OUTGOING_SEED: ContactRequestView = {
  id: 'req-cara',
  status: 'pending',
  createdAt: CREATED_AT,
  other: { userId: 'u-cara', name: 'Cara', handle: 'cara', image: null },
};

export function contactsMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): ContactsMockScenario | null {
  const rawParam = params?.['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : env['EXPO_PUBLIC_ZILAR_MOCK'];
  if (requested === undefined || requested === '' || requested === '0') {
    return null;
  }
  if (requested === '1') {
    return normalizeScenario(env['EXPO_PUBLIC_ZILAR_MOCK_SCENARIO']) ?? 'default';
  }
  return normalizeScenario(requested);
}

function normalizeScenario(value: string | undefined): ContactsMockScenario | null {
  switch (value) {
    case 'default':
    case 'empty':
    case 'error':
      return value;
    default:
      return null;
  }
}

interface MockState {
  profiles: HandleProfile[];
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
  blocked: BlockedPerson[];
}

const states = new Map<ContactsMockScenario, MockState>();

function stateFor(scenario: ContactsMockScenario): MockState {
  const existing = states.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const created: MockState =
    scenario === 'empty'
      ? { profiles: [], incoming: [], outgoing: [], blocked: [] }
      : {
          profiles: PROFILES.map((profile) => ({ ...profile })),
          incoming: [{ ...INCOMING_SEED, other: { ...INCOMING_SEED.other } }],
          outgoing: [{ ...OUTGOING_SEED, other: { ...OUTGOING_SEED.other } }],
          blocked: [{ ...BLOCKED_SEED }],
        };
  states.set(scenario, created);
  return created;
}

let sequence = 0;

/**
 * Clears the per-scenario state and the id sequence. Tests call this between
 * cases so they do not depend on the order they run in.
 */
export function resetContactsMock(): void {
  states.clear();
  sequence = 0;
}

/** A `ContactsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockContactsApi(scenario: ContactsMockScenario = 'default'): ContactsApi {
  const state = stateFor(scenario);

  const failIfError = (): void => {
    if (scenario === 'error') {
      throw new ContactsApiError(500, 'internal_error', 'The server hit an unexpected error');
    }
  };

  const profileFor = (handle: string): HandleProfile => {
    const found = state.profiles.find((profile) => profile.handle === handle.toLowerCase());
    if (found === undefined) {
      throw new ContactsApiError(404, 'not_found', 'No user with that username');
    }
    return { ...found };
  };

  const takeRequest = (id: string): { row: ContactRequestView; side: 'in' | 'out' } => {
    const inIndex = state.incoming.findIndex((row) => row.id === id);
    if (inIndex !== -1) {
      const row = state.incoming[inIndex];
      if (row === undefined) {
        throw new ContactsApiError(404, 'not_found', 'Not found');
      }
      return { row, side: 'in' };
    }
    const outIndex = state.outgoing.findIndex((row) => row.id === id);
    if (outIndex !== -1) {
      const row = state.outgoing[outIndex];
      if (row === undefined) {
        throw new ContactsApiError(404, 'not_found', 'Not found');
      }
      return { row, side: 'out' };
    }
    throw new ContactsApiError(404, 'not_found', 'Not found');
  };

  return {
    async lookupByHandle(handle) {
      failIfError();
      return profileFor(handle);
    },
    async sendContactRequest(handle): Promise<CreatedContactRequest> {
      failIfError();
      const profile = profileFor(handle);
      if (profile.relation === 'self') {
        throw new ContactsApiError(400, 'invalid_request', 'You cannot add yourself');
      }
      if (profile.relation === 'blocked') {
        throw new ContactsApiError(409, 'blocked', 'Unblock this person first');
      }
      if (profile.relation === 'contact') {
        throw new ContactsApiError(409, 'already_contact', 'You are already contacts');
      }
      if (profile.relation === 'request_sent') {
        throw new ContactsApiError(409, 'request_exists', 'A request is already pending');
      }
      if (profile.relation === 'request_received') {
        const reverse = state.incoming.find((row) => row.other.userId === profile.userId);
        if (reverse === undefined) {
          throw new ContactsApiError(409, 'request_exists', 'A request is already pending');
        }
        return {
          request: {
            id: reverse.id,
            fromUserId: reverse.other.userId,
            toUserId: 'u-me',
            status: 'pending',
            createdAt: reverse.createdAt,
          },
          incoming: true,
        };
      }
      sequence += 1;
      const id = `req-mock-${sequence}`;
      const createdAt = new Date().toISOString();
      const row: ContactRequestView = {
        id,
        status: 'pending',
        createdAt,
        other: {
          userId: profile.userId,
          name: profile.name,
          handle: profile.handle,
          image: profile.image,
        },
      };
      state.outgoing.unshift(row);
      const stored = state.profiles.find((entry) => entry.userId === profile.userId);
      if (stored !== undefined) {
        stored.relation = 'request_sent';
      }
      return {
        request: {
          id,
          fromUserId: 'u-me',
          toUserId: profile.userId,
          status: 'pending',
          createdAt,
        },
      };
    },
    async listContactRequests(): Promise<ContactRequestList> {
      failIfError();
      return {
        incoming: state.incoming.map((row) => ({ ...row, other: { ...row.other } })),
        outgoing: state.outgoing.map((row) => ({ ...row, other: { ...row.other } })),
      };
    },
    async acceptContactRequest(id) {
      failIfError();
      const { row, side } = takeRequest(id);
      if (side !== 'in') {
        throw new ContactsApiError(404, 'not_found', 'Not found');
      }
      state.incoming.splice(state.incoming.indexOf(row), 1);
      const stored = state.profiles.find((entry) => entry.userId === row.other.userId);
      if (stored !== undefined) {
        stored.relation = 'contact';
      }
      return {
        request: {
          id: row.id,
          fromUserId: row.other.userId,
          toUserId: 'u-me',
          status: 'accepted' as const,
          createdAt: row.createdAt,
          decidedAt: new Date().toISOString(),
        },
      };
    },
    async declineContactRequest(id) {
      failIfError();
      const { row, side } = takeRequest(id);
      if (side !== 'in') {
        throw new ContactsApiError(404, 'not_found', 'Not found');
      }
      state.incoming.splice(state.incoming.indexOf(row), 1);
      const stored = state.profiles.find((entry) => entry.userId === row.other.userId);
      if (stored !== undefined) {
        stored.relation = 'none';
      }
      return {
        request: {
          id: row.id,
          fromUserId: row.other.userId,
          toUserId: 'u-me',
          status: 'declined' as const,
          createdAt: row.createdAt,
          decidedAt: new Date().toISOString(),
        },
      };
    },
    async cancelContactRequest(id) {
      failIfError();
      const { row, side } = takeRequest(id);
      if (side !== 'out') {
        throw new ContactsApiError(404, 'not_found', 'Not found');
      }
      state.outgoing.splice(state.outgoing.indexOf(row), 1);
      const stored = state.profiles.find((entry) => entry.userId === row.other.userId);
      if (stored !== undefined) {
        stored.relation = 'none';
      }
      return {
        request: {
          id: row.id,
          fromUserId: 'u-me',
          toUserId: row.other.userId,
          status: 'cancelled' as const,
          createdAt: row.createdAt,
          decidedAt: new Date().toISOString(),
        },
      };
    },
    async blockUser(userId) {
      failIfError();
      if (userId === 'u-me') {
        throw new ContactsApiError(400, 'invalid_request', 'You cannot block yourself');
      }
      const profile = state.profiles.find((entry) => entry.userId === userId);
      const existing = state.blocked.find((entry) => entry.userId === userId);
      if (profile === undefined && existing === undefined) {
        throw new ContactsApiError(404, 'not_found', 'User not found');
      }
      if (existing === undefined) {
        state.blocked.unshift(
          profile === undefined
            ? { userId, name: 'Unnamed user', handle: null, image: null, jid: null }
            : {
                userId: profile.userId,
                name: profile.name,
                handle: profile.handle,
                image: profile.image,
                jid: null,
              },
        );
      }
      if (profile !== undefined) {
        profile.relation = 'blocked';
      }
      return { blocked: true };
    },
    async unblockUser(userId) {
      failIfError();
      state.blocked = state.blocked.filter((entry) => entry.userId !== userId);
      const stored = state.profiles.find((entry) => entry.userId === userId);
      if (stored !== undefined && stored.relation === 'blocked') {
        stored.relation = 'none';
      }
      return { blocked: false };
    },
    async listBlockedUsers() {
      failIfError();
      return state.blocked.map((entry) => ({ ...entry }));
    },
  };
}
