import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createConnectionsApi, type ConnectionsApi } from '@/lib/connections-api';
import { getSessionToken } from '@/lib/session-token';
import {
  connectionsMockScenario,
  createMockConnectionsApi,
  type ConnectionsMockScenario,
} from './connections-mock';
import { mockParamAllowed } from '@/mock/gate';

export interface ConnectionsApiHandle {
  api: ConnectionsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ConnectionsMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useConnectionsApi(): ConnectionsApiHandle {
  const params = useGlobalSearchParams();
  // Referenced as static `process.env.EXPO_PUBLIC_*` expressions so
  // babel-preset-expo inlines them into the bundle at Metro time.
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const scenario = connectionsMockScenario(
    {
      EXPO_PUBLIC_ZILAR_MOCK: envMock,
      EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO,
    },
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () =>
      scenario === null
        ? createConnectionsApi(getSessionToken)
        : createMockConnectionsApi(scenario),
    [scenario],
  );
  return { api, scenario };
}
