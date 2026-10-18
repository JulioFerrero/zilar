import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { createToolsApi, type AiToolsApi } from '@/lib/tools-api';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realToolsApi = () => createToolsApi(getSessionToken);

const mockToolsApi = (mockFetch: typeof fetch) => createToolsApi(mockToken, mockFetch, API_URL);

export interface ToolsApiHandle {
  api: AiToolsApi;
  mock: boolean;
}

export function useToolsApi(): ToolsApiHandle {
  return useMockableApi(realToolsApi, mockToolsApi);
}
