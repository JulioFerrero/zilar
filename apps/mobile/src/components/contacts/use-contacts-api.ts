import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createContactsApi, type ContactsApi } from '@/lib/contacts-api';
import { getSessionToken } from '@/lib/session-token';
import type { ContactsMockScenario } from './contacts-mock';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

export interface ContactsApiHandle {
  api: ContactsApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: ContactsMockScenario | null;
}

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function loadMock(): typeof import('./contacts-mock') | null {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./contacts-mock') as typeof import('./contacts-mock');
  }
  return null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useContactsApi(): ContactsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = loadMock();
  const scenario =
    mock?.contactsMockScenario(MOCK_ENV, params, mockParamAllowed({ dev: __DEV__, envMock })) ??
    null;
  const api = useMemo(
    () =>
      mock === null || scenario === null
        ? createContactsApi(getSessionToken)
        : mock.createMockContactsApi(scenario),
    [mock, scenario],
  );
  return { api, scenario };
}
