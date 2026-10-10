// The integrations domain's settings and mutators. Like every domain it
// extends the shared `MockSeed`/`MockData` from its own folder (module
// augmentation). No secret is ever stored: the Telegram bot token, the Resend
// key and the transcription key are write-only, so the state keeps a
// "configured" bit plus the non-secret fields only.

import type { IntegrationsStatus } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

/** The owner's integration settings, mirroring the server's stored rows. */
export interface MockIntegrations {
  readonly telegramConfigured: boolean;
  readonly emailConfigured: boolean;
  readonly emailFrom: string | null;
  readonly voiceConfigured: boolean;
  readonly voiceBaseUrl: string | null;
  readonly voiceModel: string | null;
}

declare module '../../data' {
  interface MockSeed {
    readonly integrations: MockIntegrations;
  }
}

declare module '../../state' {
  interface MockData {
    readonly integrations: MockIntegrations;
    /** A PUT of a bot token only flips the flag; the token is dropped. */
    saveIntegrationsTelegram(): void;
    removeIntegrationsTelegram(): void;
    /** A PUT of email keeps `from` and drops the Resend key. */
    saveIntegrationsEmail(from: string): void;
    /** A PUT of voice keeps the base URL and model and drops the API key. */
    saveIntegrationsVoice(baseUrl: string, model: string): void;
    removeIntegrationsVoice(): void;
    /** The contract status, derived from the seed; `source` is always `stored`. */
    integrationsStatus(): IntegrationsStatus;
  }
}

/**
 * The integrations settings. The object is replaced on every write, never
 * mutated in place, so a `reset()` cannot leak a previous seed.
 */
export function createIntegrationsState(seed: MockSeed): Partial<MockData> {
  let settings: MockIntegrations = { ...seed.integrations };
  return {
    get integrations(): MockIntegrations {
      return settings;
    },
    saveIntegrationsTelegram(): void {
      settings = { ...settings, telegramConfigured: true };
    },
    removeIntegrationsTelegram(): void {
      settings = { ...settings, telegramConfigured: false };
    },
    saveIntegrationsEmail(from: string): void {
      settings = { ...settings, emailConfigured: true, emailFrom: from };
    },
    saveIntegrationsVoice(baseUrl: string, model: string): void {
      settings = { ...settings, voiceConfigured: true, voiceBaseUrl: baseUrl, voiceModel: model };
    },
    removeIntegrationsVoice(): void {
      settings = { ...settings, voiceConfigured: false, voiceBaseUrl: null, voiceModel: null };
    },
    integrationsStatus(): IntegrationsStatus {
      return {
        telegram: {
          configured: settings.telegramConfigured,
          source: settings.telegramConfigured ? 'stored' : null,
        },
        email: {
          configured: settings.emailConfigured,
          source: settings.emailConfigured ? 'stored' : null,
          from: settings.emailFrom,
        },
        voiceTranscription: {
          configured: settings.voiceConfigured,
          baseUrl: settings.voiceBaseUrl,
          model: settings.voiceModel,
        },
        canManage: true,
      };
    },
  };
}
