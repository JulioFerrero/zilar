// effect-plain: a React hook; the env guard must stay literal for Metro to fold the mock out
import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ENV_MOCK, apiMockActive, mockParamAllowed } from '@/mock/gate';

/**
 * The `require` sits behind a literal build-time condition, so Metro folds it to `false` in a release build and the mock stays out of the bundle.
 */
export function useMockableApi<A>(
  real: () => A,
  mock: (mockFetch: typeof fetch) => A,
): { api: A; mock: boolean } {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const active = apiMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(() => {
    if (!active) {
      return real();
    }
    if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
      return mock(mockFetch);
    }
    throw new Error('The mock API is not part of this build');
  }, [active, real, mock]);
  return { api, mock: active };
}
