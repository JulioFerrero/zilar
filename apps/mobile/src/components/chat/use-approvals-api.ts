import { API_URL } from '@/lib/auth';
import { createApprovalsApi, type ApprovalsApi } from '@/lib/approvals-api';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realApprovalsApi = () => createApprovalsApi(getSessionToken);

const mockApprovalsApi = (mockFetch: typeof fetch) =>
  createApprovalsApi(mockToken, mockFetch, API_URL);

export interface ApprovalsApiHandle {
  api: ApprovalsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

// Picks the real API or the mock one from the route's `?mock=` param or `EXPO_PUBLIC_ZILAR_MOCK`. The mock runs on the shared backend through `mockFetch`, so the card and the Approvals rules work without a server.
export function useApprovalsApi(): ApprovalsApiHandle {
  return useMockableApi(realApprovalsApi, mockApprovalsApi);
}
