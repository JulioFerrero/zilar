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
  mock: boolean;
}

export function useMachinesApi(): MachinesApiHandle {
  return useMockableApi(realMachinesApi, mockMachinesApi);
}
