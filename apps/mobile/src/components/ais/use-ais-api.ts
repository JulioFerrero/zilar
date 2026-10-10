import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createAisApi, type AisApi } from '@/lib/ais-api';
import { getSessionToken } from '@/lib/session-token';
import type { AisMockScenario } from '@/mock/ais';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface AisApiHandle {
  api: AisApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: AisMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('@/mock/ais') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/mock/ais') as typeof import('@/mock/ais');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useAisApi(): AisApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.aisMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ?? null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createAisApi(getSessionToken)
        : mock.createMockAisApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
