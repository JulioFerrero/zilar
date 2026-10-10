import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createMachinesApi, type MachinesApi } from '@/lib/machines-api';
import { getSessionToken } from '@/lib/session-token';
import type { MachinesMockScenario } from './machines-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface MachinesApiHandle {
  api: MachinesApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: MachinesMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('./machines-mock') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./machines-mock') as typeof import('./machines-mock');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useMachinesApi(): MachinesApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.machinesMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createMachinesApi(getSessionToken)
        : mock.createMockMachinesApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
