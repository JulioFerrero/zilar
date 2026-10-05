import {
  ProfileApiError,
  type HandleCheck,
  type MyProfile,
  type ProfileApi,
} from '../lib/profile-api';

/**
 * Mock profile API for `EXPO_PUBLIC_ZILAR_MOCK=1` or `?mock=<scenario>`.
 * The mock mirrors the server's handle check/claim and the avatar slot in
 * memory: claiming a handle takes it (a second claim of the same handle
 * answers 409 `handle_taken`), and uploaded avatar urls persist until
 * removed. Reserved and invalid handles answer like the server.
 */

export type ProfileMockScenario = 'default' | 'error';

const RESERVED: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'root',
  'system',
  'zilar',
  'ejabberd',
  'api',
  'settings',
  'me',
  'everyone',
  'all',
  'here',
  'channel',
  'bot',
  'owner',
  'moderator',
]);

const TAKEN: ReadonlySet<string> = new Set(['ada', 'grace_hopper']);

/**
 * Which mock scenario a session asked for, or null for the real API. The
 * same gate as the AI screens: a `?mock=<scenario>` param wins over
 * `EXPO_PUBLIC_ZILAR_MOCK` in dev builds (`paramAllowed`), otherwise the
 * env var decides. Any unrecognized value means the real API.
 */
export function profileMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): ProfileMockScenario | null {
  const rawParam = params?.['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : env['EXPO_PUBLIC_ZILAR_MOCK'];
  if (requested === undefined || requested === '' || requested === '0') {
    return null;
  }
  if (requested === '1') {
    return env['EXPO_PUBLIC_ZILAR_MOCK_SCENARIO'] === 'error' ? 'error' : 'default';
  }
  return requested === 'default' || requested === 'error' ? requested : null;
}

const claimed = new Set<string>();
const avatarUrls = new Map<string, string>();
let avatarSequence = 0;

// The seeded signed-in profile. Claiming a handle updates it (like the
// session would after a refetch), and removing the avatar clears its url.
const mockMe: {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  avatarUrl?: string | undefined;
} = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  handle: null,
};

/**
 * Clears the claimed handles and avatar urls. Tests call this between cases
 * so they do not depend on the order they run in.
 */
export function resetProfileMock(): void {
  claimed.clear();
  avatarUrls.clear();
  avatarSequence = 0;
  mockMe.handle = null;
  delete mockMe.avatarUrl;
}

function classify(handle: string): HandleCheck {
  const trimmed = handle.trim();
  if (RESERVED.has(trimmed.toLowerCase())) {
    return { available: false, reason: 'reserved' };
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(trimmed)) {
    return { available: false, reason: 'invalid' };
  }
  if (TAKEN.has(trimmed.toLowerCase()) || claimed.has(trimmed.toLowerCase())) {
    return { available: false, reason: 'taken' };
  }
  return { available: true };
}

/** The next mock avatar id, so uploaded urls stay unique per upload. */
function nextAvatarId(): number {
  avatarSequence += 1;
  return avatarSequence;
}

/** Reads the `{ url }` an injected uploader resolved, or null when unexpected. */
function parseMockUploadResult(uploaded: unknown): string | null {
  if (typeof uploaded !== 'object' || uploaded === null) {
    return null;
  }
  const url = (uploaded as Record<string, unknown>)['url'];
  return typeof url === 'string' ? url : null;
}

/** A `ProfileApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockProfileApi(scenario: ProfileMockScenario = 'default'): ProfileApi {
  const fail = (): never => {
    throw new ProfileApiError(500, 'internal_error', 'The server hit an unexpected error');
  };
  return {
    async getMe(): Promise<MyProfile> {
      if (scenario === 'error') fail();
      return { ...mockMe };
    },
    async checkHandle(handle) {
      if (scenario === 'error') fail();
      return classify(handle);
    },
    async claimHandle(handle) {
      if (scenario === 'error') fail();
      const check = classify(handle);
      if (!check.available) {
        const code =
          check.reason === 'reserved'
            ? 'handle_reserved'
            : check.reason === 'invalid'
              ? 'handle_invalid'
              : 'handle_taken';
        const status = check.reason === 'invalid' ? 400 : 409;
        throw new ProfileApiError(status, code, `That username is ${check.reason ?? 'taken'}`);
      }
      claimed.add(handle.trim().toLowerCase());
      mockMe.handle = handle.trim();
      return { handle: handle.trim() };
    },
    async uploadAvatar(ownerId, blob, uploader) {
      if (scenario === 'error') fail();
      // Production uploads the picked file through the injected native
      // uploader (React Native's `fetch` cannot send binary bodies): the
      // uploader PUTs and parses the server's `{ url }`, like the real one.
      if (uploader !== undefined) {
        // There is no server behind the mock URL: a real uploader cannot
        // reach it, so a failure falls back to a minted url like the plain path.
        const uploaded = await uploader(
          `mock:/api/avatars/user/${encodeURIComponent(ownerId)}`,
          blob.type,
        ).catch(() => undefined);
        const url = parseMockUploadResult(uploaded) ?? `/api/avatars/mock-${nextAvatarId()}`;
        avatarUrls.set(ownerId, url);
        if (ownerId === mockMe.id) {
          mockMe.avatarUrl = url;
        }
        return { url };
      }
      if (blob.size === 0) {
        throw new ProfileApiError(400, 'avatar_empty', 'The picture file is empty');
      }
      avatarSequence += 1;
      const url = `/api/avatars/mock-${avatarSequence}`;
      avatarUrls.set(ownerId, url);
      if (ownerId === mockMe.id) {
        mockMe.avatarUrl = url;
      }
      return { url };
    },
    async removeAvatar(ownerId) {
      if (scenario === 'error') fail();
      avatarUrls.delete(ownerId);
      if (ownerId === mockMe.id) {
        delete mockMe.avatarUrl;
      }
    },
  };
}

/** The mock avatar url for an owner, or undefined when none was uploaded. */
export function mockAvatarUrlFor(ownerId: string): string | undefined {
  return avatarUrls.get(ownerId);
}
