// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/settings/integrations' },
  { method: 'PUT', path: '/api/settings/integrations/telegram' },
  { method: 'DELETE', path: '/api/settings/integrations/telegram' },
  { method: 'PUT', path: '/api/settings/integrations/email' },
] as const;
