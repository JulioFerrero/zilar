import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createProfileApi, type ProfileApi } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';
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
  const envMock = ENV_MOCK;
  const scenario = profileMockScenario(
    MOCK_ENV,
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () => (scenario === null ? createProfileApi(getSessionToken) : createMockProfileApi(scenario)),
    [scenario],
  );
  return { api, scenario };
}
