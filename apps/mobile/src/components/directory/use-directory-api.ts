import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createDirectoryApi, type DirectoryApi } from '@/lib/directory-api';
import { getSessionToken } from '@/lib/session-token';
import {
  directoryMockScenario,
  createMockDirectoryApi,
  type DirectoryMockScenario,
} from '@/mock/directory';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface DirectoryApiHandle {
  api: DirectoryApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: DirectoryMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useDirectoryApi(): DirectoryApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = directoryMockScenario(
    MOCK_ENV,
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () => (scenario === null ? createDirectoryApi(getSessionToken) : createMockDirectoryApi()),
    [scenario],
  );
  return { api, scenario };
}
