import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createAiMemoryApi, type AiMemoryApi } from '@/lib/ai-memory-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, mockParamAllowed } from '@/mock/gate';

/**
 * Loads the mock behind a literal build-time condition: Metro folds it to
 * `false` in a release build, so the mock module stays out of the bundle.
 */
function createMockAiMemory(): AiMemoryApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (
      require('@/mock/ai-memory') as typeof import('@/mock/ai-memory')
    ).createMockAiMemoryApi();
  }
  throw new Error('The mock API is not part of this build');
}

/**
 * The AI memory API supports exactly one mock scenario (the seeded memory),
 * so a yes/no answer is enough. The shape mirrors `use-audit-api.ts` so the
 * AI screens pick the same mock gate and env vars.
 */
function aiMemoryMockActive(
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

export interface AiMemoryApiHandle {
  api: AiMemoryApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock serves the seeded memory,
 * so the AI edit screen shows the section without a server.
 */
export function useAiMemoryApi(): AiMemoryApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = aiMemoryMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(
    () => (mock ? createMockAiMemory() : createAiMemoryApi(getSessionToken)),
    [mock],
  );
  return { api, mock };
}
