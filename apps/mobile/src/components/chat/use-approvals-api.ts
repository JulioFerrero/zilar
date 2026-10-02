import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createApprovalsApi, type ApprovalsApi } from '@/lib/approvals-api';
import { getSessionToken } from '@/lib/session-token';
import { createMockApprovalsApi } from '@/mock/approvals';
import { mockParamAllowed } from '@/mock/gate';

/**
 * The approvals API supports exactly one mock scenario (the pending request
 * seeded in `mock/messages.ts`), so a yes/no answer is enough. The shape mirrors
 * `use-ais-api.ts` so the chat screens pick the same mock gate and env vars.
 */
function approvalsMockActive(
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
  // `false` is the one explicit opt-out; any other value (including named
  // scenarios that are not relevant here) keeps the mock on.
  return requested !== 'false';
}

export interface ApprovalsApiHandle {
  api: ApprovalsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock serves the same pending
 * approval the chat's mock card references, so the card can be approved end to
 * end without a server.
 */
export function useApprovalsApi(): ApprovalsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const mock = approvalsMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockApprovalsApi() : createApprovalsApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
