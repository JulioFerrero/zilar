import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createAuditApi, type AuditApi } from '@/lib/audit-api';
import { getSessionToken } from '@/lib/session-token';
import { createMockAuditApi } from '@/mock/audit';
import { mockParamAllowed } from '@/mock/gate';

/**
 * The audit API supports exactly one mock scenario (the seeded AI activity),
 * so a yes/no answer is enough. The shape mirrors `use-tools-api.ts` so the
 * AI screens pick the same mock gate and env vars.
 */
function auditMockActive(
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

export interface AuditApiHandle {
  api: AuditApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock serves the seeded AI
 * activity, so the AI edit screen shows the section without a server.
 */
export function useAuditApi(): AuditApiHandle {
  const params = useGlobalSearchParams();
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const mock = auditMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockAuditApi() : createAuditApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
