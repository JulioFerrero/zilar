// The integrations seed (T-1078): Telegram and email configured and stored,
// voice transcription off, mirroring the mobile mock's `default` scenario
// (`apps/mobile/src/components/integrations/integrations-mock.ts:64-75`). The
// Telegram token, the Resend key and the transcription key are never seeded.

import type { MockSeed } from '../../data';

export function seedIntegrations(): Partial<MockSeed> {
  return {
    integrations: {
      telegramConfigured: true,
      emailConfigured: true,
      emailFrom: 'Zilar <hello@example.com>',
      voiceConfigured: false,
      voiceBaseUrl: null,
      voiceModel: null,
    },
  };
}
