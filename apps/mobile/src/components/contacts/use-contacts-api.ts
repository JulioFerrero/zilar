import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createContactsApi, type ContactsApi } from '@/lib/contacts-api';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, mockParamAllowed, mockToken } from '@/mock/gate';

/**
 * Builds the mock-mode `ContactsApi` on the shared mock backend, behind a
 * literal build-time condition: Metro folds it to `false` in a release build,
 * so the mock module stays out of the bundle.
 */
function createMockContacts(): ContactsApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return createContactsApi(mockToken, mockFetch, API_URL);
  }
  throw new Error('The mock API is not part of this build');
}

/**
 * The mock-mode gate mirrors `use-machines-api.ts` so the contacts screens read
 * the same `?mock=` param and env var. In mock mode the adapter talks to the
 * shared mock backend, which seeds the by-handle lookup.
 */
function contactsMockActive(
  envMock: string | undefined,
  params: Record<string, string | string[] | undefined>,
  paramAllowed: boolean,
): boolean {
  const rawParam = params['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : envMock;
  if (requested === undefined || requested === '' || requested === '0') {
    return false;
  }
  // `false` is the one explicit opt-out; any other value (including the old
  // named scenarios) keeps the mock on.
  return requested !== 'false';
}

export interface ContactsApiHandle {
  api: ContactsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`.
 */
export function useContactsApi(): ContactsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = contactsMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockContacts() : createContactsApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
