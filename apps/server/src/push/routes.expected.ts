// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/push/config' },
  { method: 'POST', path: '/api/push/subscriptions' },
  { method: 'GET', path: '/api/push/subscriptions' },
  { method: 'DELETE', path: '/api/push/subscriptions/:id' },
  { method: 'GET', path: '/api/push/settings' },
  { method: 'PUT', path: '/api/push/settings' },
  { method: 'POST', path: '/api/push/test' },
] as const;
