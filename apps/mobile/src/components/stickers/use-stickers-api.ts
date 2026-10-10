import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { API_URL } from '@/lib/auth';
import { createStickersApi, type StickerBinaryUpload, type StickersApi } from '@/lib/stickers-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, mockParamAllowed, mockToken } from '@/mock/gate';

/** The 4 stand-in PNG bytes the mock sticker upload records; not a real picture. */
const MOCK_STICKER_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * The native `expo-file-system` upload posts to the real origin, which
 * `mockFetch` never sees, so in mock mode we skip it and POST the bytes through
 * the shared backend. Mock mode has no file bytes: the picked `uri` is a native
 * file, so these stand-in bytes are stored instead and the stored url's bytes
 * are not a real picture.
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
 * Builds the mock-mode `StickersApi` on the shared mock backend, behind a
 * literal build-time condition: Metro folds it to `false` in a release build,
 * so the mock module stays out of the bundle.
 */
function createMockStickers(): { api: StickersApi; viewerId: string } {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch, mockViewerId } =
      require('@/mock/backend') as typeof import('@/mock/backend');
    return {
      api: createStickersApi(mockToken, mockFetch, API_URL, createMockStickerUpload(mockFetch)),
      viewerId: mockViewerId,
    };
  }
  throw new Error('The mock API is not part of this build');
}

/**
 * The mock-mode gate mirrors `use-machines-api.ts` so the sticker screens read
 * the same `?mock=` param and env var. In mock mode the adapter talks to the
 * shared mock backend, which seeds the sticker packs, the panel and favorites.
 */
function stickersMockActive(
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

export interface StickersApiHandle {
  api: StickersApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
  /**
   * The viewer's id in mock mode (nobody signs in there), else `undefined`;
   * callers fall back to it wherever they need the signed-in user's id.
   */
  viewerId: string | undefined;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`.
 */
export function useStickersApi(): StickersApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = stickersMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const resolved = useMemo(
    () =>
      mock
        ? createMockStickers()
        : { api: createStickersApi(getSessionToken), viewerId: undefined },
    [mock],
  );
  return { api: resolved.api, mock, viewerId: resolved.viewerId };
}
