import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createIntegrationsApi, type IntegrationsApi } from '@/lib/integrations-api';
import { getSessionToken } from '@/lib/session-token';
import {
  createMockIntegrationsApi,
  integrationsMockScenario,
  type IntegrationsMockScenario,
} from './integrations-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface IntegrationsApiHandle {
  api: IntegrationsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: IntegrationsMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useIntegrationsApi(): IntegrationsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = integrationsMockScenario(
    MOCK_ENV,
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () =>
      scenario === null
        ? createIntegrationsApi(getSessionToken)
        : createMockIntegrationsApi(scenario),
    [scenario],
  );
  return { api, scenario };
}
