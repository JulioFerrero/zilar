import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { API_URL } from '@/lib/auth';
import { apiCall, type ApiTransport } from '@/lib/effect/api-client';
import { makeStickersApi, type StickerBinaryUpload, type StickersApi } from '@/lib/stickers-api';
import { realApiTransport } from '@/lib/use-mockable-api';
import { ENV_MOCK, apiMockActive, mockParamAllowed, mockToken } from '@/mock/gate';

/** The 4 stand-in PNG bytes the mock sticker upload records; not a real picture. */
const MOCK_STICKER_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * The native `expo-file-system` upload posts to the real origin, which
 * `mockFetch` never sees, so mock mode stores these stand-in bytes through the
 * shared backend; the stored url's bytes are not a real picture.
 */
function createMockStickerUpload(mockFetch: typeof fetch): StickerBinaryUpload {
  return {
    async upload(url, _uri, headers) {
      const response = await mockFetch(url, {
        method: 'POST',
        headers,
        body: MOCK_STICKER_BYTES,
      });
      return { status: response.status, body: await response.text() };
    },
  };
}

/**
 * Builds the mock-mode `StickersApi` behind a literal build-time condition: Metro
 * folds it to `false` in a release build, so the mock stays out of the bundle.
 */
function createMockStickers(): { api: StickersApi; viewerId: string } {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch, mockViewerId } =
      require('@/mock/backend') as typeof import('@/mock/backend');
    const transport: ApiTransport = { getToken: mockToken, fetchImpl: mockFetch, apiUrl: API_URL };
    return {
      api: makeStickersApi(apiCall(transport), transport, createMockStickerUpload(mockFetch)),
      viewerId: mockViewerId,
    };
  }
  throw new Error('The mock API is not part of this build');
}

export interface StickersApiHandle {
  api: StickersApi;
  mock: boolean;
  viewerId: string | undefined;
}

export function useStickersApi(): StickersApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = apiMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const resolved = useMemo(
    () =>
      mock
        ? createMockStickers()
        : {
            api: makeStickersApi(apiCall(realApiTransport), realApiTransport),
            viewerId: undefined,
          },
    [mock],
  );
  return { api: resolved.api, mock, viewerId: resolved.viewerId };
}
