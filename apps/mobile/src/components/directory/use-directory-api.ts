import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createDirectoryApi, type DirectoryApi } from '@/lib/directory-api';
import { getSessionToken } from '@/lib/session-token';
import {
  directoryMockScenario,
  createMockDirectoryApi,
  type DirectoryMockScenario,
} from '@/mock/directory';
import { mockParamAllowed } from '@/mock/gate';

export interface DirectoryApiHandle {
  api: DirectoryApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: DirectoryMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useDirectoryApi(): DirectoryApiHandle {
  const params = useGlobalSearchParams();
  // Referenced as static `process.env.EXPO_PUBLIC_*` expressions so
  // babel-preset-expo inlines them into the bundle at Metro time.
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const scenario = directoryMockScenario(
    {
      EXPO_PUBLIC_ZILAR_MOCK: envMock,
      EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO,
    },
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () => (scenario === null ? createDirectoryApi(getSessionToken) : createMockDirectoryApi()),
    [scenario],
  );
  return { api, scenario };
}
