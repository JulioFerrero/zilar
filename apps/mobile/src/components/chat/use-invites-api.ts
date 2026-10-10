import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createInvitesApi, type InvitesApi } from '@/lib/invites-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, mockParamAllowed } from '@/mock/gate';

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function createMockInvites(): InvitesApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/mock/invites') as typeof import('@/mock/invites')).createMockInvitesApi();
  }
  throw new Error('The mock API is not part of this build');
}

export interface InvitesApiHandle {
  api: InvitesApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The shape mirrors
 * `use-approvals-api.ts` so screens pick the same mock gate and env vars.
 */
export function useInvitesApi(): InvitesApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const rawParam = params['mock'];
  const param = mockParamAllowed({ dev: __DEV__, envMock })
    ? Array.isArray(rawParam)
      ? rawParam[0]
      : rawParam
    : undefined;
  const requested = param !== undefined ? param : envMock;
  const mock =
    requested !== undefined && requested !== '' && requested !== '0' && requested !== 'false';
  const api = useMemo(
    () => (mock ? createMockInvites() : createInvitesApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
