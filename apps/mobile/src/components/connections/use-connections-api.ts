import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createConnectionsApi, type ConnectionsApi } from '@/lib/connections-api';
import { getSessionToken } from '@/lib/session-token';
import {
  connectionsMockScenario,
  createMockConnectionsApi,
  type ConnectionsMockScenario,
} from './connections-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface ConnectionsApiHandle {
  api: ConnectionsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ConnectionsMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useConnectionsApi(): ConnectionsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = connectionsMockScenario(
    MOCK_ENV,
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
