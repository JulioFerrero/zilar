import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createMachinesApi, type MachinesApi } from '@/lib/machines-api';
import { getSessionToken } from '@/lib/session-token';
import {
  machinesMockScenario,
  createMockMachinesApi,
  type MachinesMockScenario,
} from './machines-mock';
import { mockParamAllowed } from '@/mock/gate';

export interface MachinesApiHandle {
  api: MachinesApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: MachinesMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useMachinesApi(): MachinesApiHandle {
  const params = useGlobalSearchParams();
  // Referenced as static `process.env.EXPO_PUBLIC_*` expressions so
  // babel-preset-expo inlines them into the bundle at Metro time.
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const scenario = machinesMockScenario(
    {
      EXPO_PUBLIC_ZILAR_MOCK: envMock,
      EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO,
    },
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () =>
      scenario === null ? createMachinesApi(getSessionToken) : createMockMachinesApi(scenario),
    [scenario],
  );
  return { api, scenario };
}
