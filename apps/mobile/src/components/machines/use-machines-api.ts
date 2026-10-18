import { API_URL } from '@/lib/auth';
import { createMachinesApi, type MachinesApi } from '@/lib/machines-api';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realMachinesApi = () => createMachinesApi(getSessionToken);

const mockMachinesApi = (mockFetch: typeof fetch) =>
  createMachinesApi(mockToken, mockFetch, API_URL);

export interface MachinesApiHandle {
  api: MachinesApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`.
 */
export function useMachinesApi(): MachinesApiHandle {
  return useMockableApi(realMachinesApi, mockMachinesApi);
}
