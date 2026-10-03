import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createContactsApi, type ContactsApi } from '@/lib/contacts-api';
import { getSessionToken } from '@/lib/session-token';
import {
  contactsMockScenario,
  createMockContactsApi,
  type ContactsMockScenario,
} from './contacts-mock';
import { mockParamAllowed } from '@/mock/gate';

export interface ContactsApiHandle {
  api: ContactsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ContactsMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useContactsApi(): ContactsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const scenario = contactsMockScenario(
    {
      EXPO_PUBLIC_ZILAR_MOCK: envMock,
      EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO,
    },
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () =>
      scenario === null ? createContactsApi(getSessionToken) : createMockContactsApi(scenario),
    [scenario],
  );
  return { api, scenario };
}
