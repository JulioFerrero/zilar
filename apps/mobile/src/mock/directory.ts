import type { DirectoryApi, DirectoryEntry } from '../lib/directory-api';

/**
 * Mock public directory for `EXPO_PUBLIC_ZILAR_MOCK=1` or `?mock=<scenario>`.
 * The explore screen mutates membership, so joining in mock mode marks the
 * entry joined when you return to the list, without a server.
 */

export type DirectoryMockScenario = 'default' | 'empty' | 'error';

const CREATED: DirectoryEntry[] = [
  {
    id: 'group-hiking',
    kind: 'group',
    title: 'Hiking club',
    handle: 'hiking_club',
    description: 'Weekend trails and maps.',
    memberCount: 42,
    joined: false,
  },
  {
    id: 'channel-news',
    kind: 'channel',
    title: 'Zilar news',
    handle: 'zilar_news',
    description: 'Release notes and outages.',
    memberCount: 1300,
    joined: true,
  },
  {
    id: 'group-cooking',
    kind: 'group',
    title: 'Cooking',
    handle: 'cooking',
    description: null,
    memberCount: 7,
    joined: false,
  },
];

export function directoryMockScenario(
  env: { EXPO_PUBLIC_ZILAR_MOCK?: string; EXPO_PUBLIC_ZILAR_MOCK_SCENARIO?: string },
  params: Record<string, string | string[] | undefined>,
  allowed: boolean,
): DirectoryMockScenario | null {
  if (!allowed) {
    return null;
  }
  const fromParams = params['mock'];
  const raw =
    (Array.isArray(fromParams) ? fromParams[0] : fromParams) ??
    env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO ??
    env.EXPO_PUBLIC_ZILAR_MOCK;
  if (raw === 'empty') return 'empty';
  if (raw === 'error') return 'error';
  if (raw === '1' || raw === 'true' || raw === 'default') return 'default';
  return null;
}

export function createMockDirectoryApi(scenario: DirectoryMockScenario = 'default'): DirectoryApi {
  const entries: DirectoryEntry[] = CREATED.map((entry) => ({ ...entry }));
  if (scenario === 'error') {
    const failure = () =>
      Promise.reject(
        Object.assign(new Error('mock failure'), { status: 500, code: 'request_failed' }),
      );
    return {
      searchDirectory: failure,
      lookupGroupByHandle: failure,
      joinPublicGroup: failure,
      getGroupVisibility: failure,
      setGroupVisibility: failure,
      checkGroupHandle: failure,
    };
  }
  const source = scenario === 'empty' ? [] : entries;
  return {
    async searchDirectory(input = {}) {
      const query = (input.q ?? '').trim().toLowerCase();
      const filtered = source.filter((entry) => {
        if (input.kind !== undefined && entry.kind !== input.kind) return false;
        if (query === '') return true;
        return (
          entry.title.toLowerCase().includes(query) || entry.handle.toLowerCase().includes(query)
        );
      });
      return { entries: filtered.map((entry) => ({ ...entry })), next: null };
    },
    async lookupGroupByHandle(handle) {
      const found = source.find((entry) => entry.handle.toLowerCase() === handle.toLowerCase());
      if (found === undefined) {
        throw Object.assign(new Error('not found'), { status: 404, code: 'not_found' });
      }
      return { ...found };
    },
    async joinPublicGroup(groupId) {
      const found = source.find((entry) => entry.id === groupId);
      if (found === undefined) {
        throw Object.assign(new Error('not found'), { status: 404, code: 'not_found' });
      }
      const alreadyMember = found.joined;
      found.joined = true;
      return { groupId: found.id, alreadyMember };
    },
    async getGroupVisibility() {
      return { visibility: 'private', handle: null };
    },
    async setGroupVisibility() {},
    async checkGroupHandle(handle) {
      const taken = source.some(
        (entry) => entry.handle.toLowerCase() === handle.trim().toLowerCase(),
      );
      return taken ? { available: false, reason: 'taken' } : { available: true };
    },
  };
}
