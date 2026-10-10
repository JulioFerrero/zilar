import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createProfileApi, type ProfileApi } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';
import type { ProfileMockScenario } from '@/mock/profile';

export interface ProfileApiHandle {
  api: ProfileApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ProfileMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('@/mock/profile') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/mock/profile') as typeof import('@/mock/profile');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useProfileApi(): ProfileApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.profileMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createProfileApi(getSessionToken)
        : mock.createMockProfileApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
