import { createAisApi, type AisApi } from '@/lib/ais-api';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realAisApi = () => createAisApi(getSessionToken);

const mockAisApi = (mockFetch: typeof fetch) => createAisApi(mockToken, mockFetch, API_URL);

export interface AisApiHandle {
  api: AisApi;
  mock: boolean;
}

export function useAisApi(): AisApiHandle {
  return useMockableApi(realAisApi, mockAisApi);
}
