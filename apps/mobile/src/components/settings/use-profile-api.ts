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
import { ENV_MOCK, apiMockActive, mockParamAllowed, mockToken } from '@/mock/gate';

/** The 4 stand-in PNG bytes the mock avatar upload sends; not a real picture. */
const MOCK_AVATAR_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * Builds the mock-mode `ProfileApi` behind a literal build-time condition: Metro
 * folds it to `false` in a release build, so the mock stays out of the bundle.
 */
function createMockProfile(): ProfileApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    const api = createProfileApi(mockToken, mockFetch, API_URL);
    return {
      ...api,
      // The screens hand a native uploader (an `expo-file-system` PUT) that no
      // mock backend can serve, so mock mode PUTs the bytes through the shared
      // backend instead. The stored bytes are not a real picture, so the screens
      // fall back to the ball avatar.
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

export interface ProfileApiHandle {
  api: ProfileApi;
  mock: boolean;
}

export function useProfileApi(): ProfileApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = apiMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockProfile() : createProfileApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
