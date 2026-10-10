import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createIntegrationsApi, type IntegrationsApi } from '@/lib/integrations-api';
import { getSessionToken } from '@/lib/session-token';
import type { IntegrationsMockScenario } from './integrations-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface IntegrationsApiHandle {
  api: IntegrationsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: IntegrationsMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('./integrations-mock') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./integrations-mock') as typeof import('./integrations-mock');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useIntegrationsApi(): IntegrationsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.integrationsMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createIntegrationsApi(getSessionToken)
        : mock.createMockIntegrationsApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
