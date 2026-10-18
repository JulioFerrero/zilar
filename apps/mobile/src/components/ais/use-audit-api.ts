import { createAuditApi, type AuditApi } from '@/lib/audit-api';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realAuditApi = () => createAuditApi(getSessionToken);

const mockAuditApi = (mockFetch: typeof fetch) => createAuditApi(mockToken, mockFetch, API_URL);

export interface AuditApiHandle {
  api: AuditApi;
  mock: boolean;
}

export function useAuditApi(): AuditApiHandle {
  return useMockableApi(realAuditApi, mockAuditApi);
}
