import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createContactsApi, type ContactsApi } from '@/lib/contacts-api';
import { getSessionToken } from '@/lib/session-token';
import {
  contactsMockScenario,
  createMockContactsApi,
  type ContactsMockScenario,
} from './contacts-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface ContactsApiHandle {
  api: ContactsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ContactsMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useContactsApi(): ContactsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = contactsMockScenario(
    MOCK_ENV,
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
