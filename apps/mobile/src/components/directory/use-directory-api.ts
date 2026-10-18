import { API_URL } from '@/lib/auth';
import { createDirectoryApi, type DirectoryApi } from '@/lib/directory-api';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realDirectoryApi = () => createDirectoryApi(getSessionToken);

const mockDirectoryApi = (mockFetch: typeof fetch) =>
  createDirectoryApi(mockToken, mockFetch, API_URL);

export interface DirectoryApiHandle {
  api: DirectoryApi;
  mock: boolean;
}

export function useDirectoryApi(): DirectoryApiHandle {
  return useMockableApi(realDirectoryApi, mockDirectoryApi);
}
