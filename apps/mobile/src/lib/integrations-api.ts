import { runApi } from '@zilar/api-contract';
import { makeIntegrationsApi } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

// Owner-only: anyone else gets the same 404 as an unknown route. Secrets travel only in the body.

export type {
  EmailIntegrationStatus,
  IntegrationsStatus,
  TelegramIntegrationStatus,
  VoiceIntegrationStatus,
} from '@zilar/api-contract';

export type IntegrationsApi = ReturnType<typeof makeIntegrationsApi>;
export type { SaveEmailSettingsInput, SaveVoiceTranscriptionInput } from '@zilar/client-core';

export function createIntegrationsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): IntegrationsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeIntegrationsApi((call) => runApi(call(client)));
}
