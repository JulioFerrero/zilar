import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createConnectionsApi, type ConnectionsApi } from '@/lib/connections-api';
import { getSessionToken } from '@/lib/session-token';
import type { ConnectionsMockScenario } from './connections-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface ConnectionsApiHandle {
  api: ConnectionsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ConnectionsMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('./connections-mock') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./connections-mock') as typeof import('./connections-mock');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useConnectionsApi(): ConnectionsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.connectionsMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createConnectionsApi(getSessionToken)
        : mock.createMockConnectionsApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
