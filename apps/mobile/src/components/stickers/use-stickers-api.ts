import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createStickersApi, type StickersApi } from '@/lib/stickers-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

import type { StickersMockScenario } from './stickers-mock';

export interface StickersApiHandle {
  api: StickersApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: StickersMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('./stickers-mock') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./stickers-mock') as typeof import('./stickers-mock');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useStickersApi(): StickersApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.stickersMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createStickersApi(getSessionToken)
        : mock.createMockStickersApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
