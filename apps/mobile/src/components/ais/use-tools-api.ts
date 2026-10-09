import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createToolsApi, type AiToolsApi } from '@/lib/tools-api';
import { getSessionToken } from '@/lib/session-token';
import { createMockToolsApi } from '@/mock/tools';
import { ENV_MOCK, mockParamAllowed } from '@/mock/gate';

/**
 * The tools API supports exactly one mock scenario (the seeded tools and
 * routines), so a yes/no answer is enough. The shape mirrors
 * `use-approvals-api.ts` so the AI screens pick the same mock gate and env
 * vars.
 */
function toolsMockActive(
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

export interface ToolsApiHandle {
  api: AiToolsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock serves the seeded tools
 * and routines, so the AI edit screen shows both sections without a server.
 */
export function useToolsApi(): ToolsApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = toolsMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockToolsApi() : createToolsApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
