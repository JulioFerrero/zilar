import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createAisApi, type AisApi } from '@/lib/ais-api';
import { getSessionToken } from '@/lib/session-token';
import { aisMockScenario, createMockAisApi, type AisMockScenario } from '@/mock/ais';

export interface AisApiHandle {
  api: AisApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: AisMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useAisApi(): AisApiHandle {
  const params = useGlobalSearchParams();
  const scenario = aisMockScenario(
    {
      // Referenced as static `process.env.EXPO_PUBLIC_*` expressions so
      // babel-preset-expo inlines them into the bundle at Metro time.
      EXPO_PUBLIC_GALENA_MOCK: process.env.EXPO_PUBLIC_GALENA_MOCK,
      EXPO_PUBLIC_GALENA_MOCK_SCENARIO: process.env.EXPO_PUBLIC_GALENA_MOCK_SCENARIO,
    },
    params,
  );
  const api = useMemo(
    () => (scenario === null ? createAisApi(getSessionToken) : createMockAisApi(scenario)),
    [scenario],
  );
  return { api, scenario };
}
