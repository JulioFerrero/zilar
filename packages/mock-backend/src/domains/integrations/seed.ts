// The integrations seed (T-1078): the shared default, with Telegram and email
// configured and voice transcription set up. The Telegram token, the Resend key
// and the transcription key are never seeded.

import type { MockSeed } from '../../data';

export function seedIntegrations(): Partial<MockSeed> {
  return {
    integrations: {
      telegramConfigured: true,
      emailConfigured: true,
      emailFrom: 'Zilar <hello@example.com>',
      voiceConfigured: true,
      voiceBaseUrl: 'https://api.openai.com/v1',
      voiceModel: 'whisper-1',
    },
  };
}
