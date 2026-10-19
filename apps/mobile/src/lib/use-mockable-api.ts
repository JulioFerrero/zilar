// effect-plain: a React hook; the env guard must stay literal for Metro to fold the mock out
import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ENV_MOCK, apiMockActive, mockParamAllowed, mockToken } from '@/mock/gate';

import { API_URL } from './auth';
import { apiCall, type ApiCall, type ApiTransport } from './effect/api-client';
import { getSessionToken } from './session-token';

export const realApiTransport: ApiTransport = {
  getToken: getSessionToken,
  fetchImpl: fetch,
  apiUrl: API_URL,
};

export type ApiMake<A> = (call: ApiCall, transport: ApiTransport) => A;

/**
 * Builds an API from the real or the mock transport; `make` must be module-level so the memo keeps one object across renders.
 */
export function useApi<A>(make: ApiMake<A>): { api: A; mock: boolean } {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const active = apiMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(() => {
    if (!active) {
      return make(apiCall(realApiTransport), realApiTransport);
    }
    if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
      const transport: ApiTransport = {
        getToken: mockToken,
        fetchImpl: mockFetch,
        apiUrl: API_URL,
      };
      return make(apiCall(transport), transport);
    }
    throw new Error('The mock API is not part of this build');
  }, [active, make]);
  return { api, mock: active };
}
