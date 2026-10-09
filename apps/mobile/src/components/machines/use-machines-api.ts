import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createMachinesApi, type MachinesApi } from '@/lib/machines-api';
import { getSessionToken } from '@/lib/session-token';
import {
  machinesMockScenario,
  createMockMachinesApi,
  type MachinesMockScenario,
} from './machines-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface MachinesApiHandle {
  api: MachinesApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: MachinesMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useMachinesApi(): MachinesApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = machinesMockScenario(
    MOCK_ENV,
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
