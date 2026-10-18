import { API_URL } from '@/lib/auth';
import { createIntegrationsApi, type IntegrationsApi } from '@/lib/integrations-api';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realIntegrationsApi = () => createIntegrationsApi(getSessionToken);

const mockIntegrationsApi = (mockFetch: typeof fetch) =>
  createIntegrationsApi(mockToken, mockFetch, API_URL);

export interface IntegrationsApiHandle {
  api: IntegrationsApi;
  mock: boolean;
}

export function useIntegrationsApi(): IntegrationsApiHandle {
  return useMockableApi(realIntegrationsApi, mockIntegrationsApi);
}
