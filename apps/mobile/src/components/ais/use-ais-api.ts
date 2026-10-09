import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createAisApi, type AisApi } from '@/lib/ais-api';
import { getSessionToken } from '@/lib/session-token';
import { aisMockScenario, createMockAisApi, type AisMockScenario } from '@/mock/ais';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface AisApiHandle {
  api: AisApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: AisMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useAisApi(): AisApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = aisMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (scenario === null ? createAisApi(getSessionToken) : createMockAisApi(scenario)),
    [scenario],
  );
  return { api, scenario };
}
