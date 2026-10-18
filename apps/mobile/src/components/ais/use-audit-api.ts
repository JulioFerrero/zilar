import { createAuditApi, type AuditApi } from '@/lib/audit-api';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realAuditApi = () => createAuditApi(getSessionToken);

const mockAuditApi = (mockFetch: typeof fetch) => createAuditApi(mockToken, mockFetch, API_URL);

export interface AuditApiHandle {
  api: AuditApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`, so the AI edit screen shows the activity without a server.
 */
export function useAuditApi(): AuditApiHandle {
  return useMockableApi(realAuditApi, mockAuditApi);
}
