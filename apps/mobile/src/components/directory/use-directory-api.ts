import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createDirectoryApi, type DirectoryApi } from '@/lib/directory-api';
import { getSessionToken } from '@/lib/session-token';
import type { DirectoryMockScenario } from '@/mock/directory';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface DirectoryApiHandle {
  api: DirectoryApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: DirectoryMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('@/mock/directory') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/mock/directory') as typeof import('@/mock/directory');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useDirectoryApi(): DirectoryApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.directoryMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createDirectoryApi(getSessionToken)
        : mock.createMockDirectoryApi(),
    [mock, scenario],
  );
  return { api, scenario };
}
