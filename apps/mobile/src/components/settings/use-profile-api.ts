import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createProfileApi, type ProfileApi } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';
import { mockParamAllowed } from '@/mock/gate';
import {
  createMockProfileApi,
  profileMockScenario,
  type ProfileMockScenario,
} from '@/mock/profile';

export interface ProfileApiHandle {
  api: ProfileApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ProfileMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useProfileApi(): ProfileApiHandle {
  const params = useGlobalSearchParams();
  // Referenced as static `process.env.EXPO_PUBLIC_*` expressions so
  // babel-preset-expo inlines them into the bundle at Metro time.
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const scenario = profileMockScenario(
    {
      EXPO_PUBLIC_ZILAR_MOCK: envMock,
      EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO,
    },
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () => (scenario === null ? createProfileApi(getSessionToken) : createMockProfileApi(scenario)),
    [scenario],
  );
  return { api, scenario };
}
