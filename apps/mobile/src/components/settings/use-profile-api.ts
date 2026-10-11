import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { API_URL } from '@/lib/auth';
import {
  avatarPutPath,
  createProfileApi,
  ProfileApiError,
  type ProfileApi,
} from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, mockParamAllowed, mockToken } from '@/mock/gate';

/** The 4 stand-in PNG bytes the mock avatar upload sends; not a real picture. */
const MOCK_AVATAR_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * Builds the mock-mode `ProfileApi` on the shared mock backend, behind a
 * literal build-time condition: Metro folds it to `false` in a release build,
 * so the mock module stays out of the bundle.
 */
function createMockProfile(): ProfileApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    const api = createProfileApi(mockToken, mockFetch, API_URL);
    return {
      ...api,
      // The settings screens pick a photo and hand a native uploader (an
      // `expo-file-system` PUT) that no mock backend can serve, so in mock mode
      // we skip it and PUT the bytes through the shared backend instead. The
      // stored url's bytes are not a real picture, so the screens fall back to
      // the ball avatar, like the old mock fell back to initials.
      async uploadAvatar(ownerId, blob, uploader) {
        if (uploader === undefined) {
          return api.uploadAvatar(ownerId, blob);
        }
        const response = await mockFetch(`${API_URL}${avatarPutPath(ownerId)}`, {
          method: 'PUT',
          headers: { 'content-type': blob.type || 'image/png' },
          body: MOCK_AVATAR_BYTES,
        });
        const body: unknown = await response.json();
        const url =
          body !== null && typeof body === 'object'
            ? (body as Record<string, unknown>)['url']
            : undefined;
        if (typeof url !== 'string') {
          throw new ProfileApiError(
            200,
            'invalid_response',
            'The server sent an unexpected response',
          );
        }
        return { url };
      },
    };
  }
  throw new Error('The mock API is not part of this build');
}

/**
 * The mock-mode gate mirrors `use-machines-api.ts` so the profile screens read
 * the same `?mock=` param and env var. In mock mode the adapter talks to the
 * shared mock backend, which seeds the handle check and the avatar slot.
 */
function profileMockActive(
  envMock: string | undefined,
  params: Record<string, string | string[] | undefined>,
  paramAllowed: boolean,
): boolean {
  const rawParam = params['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : envMock;
  if (requested === undefined || requested === '' || requested === '0') {
    return false;
  }
  // `false` is the one explicit opt-out; any other value (including the old
  // named scenarios) keeps the mock on.
  return requested !== 'false';
}

export interface ProfileApiHandle {
  api: ProfileApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`.
 */
export function useProfileApi(): ProfileApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = profileMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockProfile() : createProfileApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
