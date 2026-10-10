// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/voice/transcription' },
  { method: 'POST', path: '/api/voice/transcript' },
  { method: 'PUT', path: '/api/settings/integrations/voice-transcription' },
  { method: 'DELETE', path: '/api/settings/integrations/voice-transcription' },
] as const;
