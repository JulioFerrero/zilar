import { makeIntegrationsApi } from '@zilar/client-core';

// Owner-only: anyone else gets the same 404 as an unknown route. Secrets travel only in the body.

export type {
  EmailIntegrationStatus,
  IntegrationsStatus,
  TelegramIntegrationStatus,
  VoiceIntegrationStatus,
} from '@zilar/api-contract';

export type IntegrationsApi = ReturnType<typeof makeIntegrationsApi>;
export type { SaveEmailSettingsInput, SaveVoiceTranscriptionInput } from '@zilar/client-core';
