// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'POST', path: '/api/machines/pairing-codes' },
  { method: 'GET', path: '/api/machines' },
  { method: 'POST', path: '/api/machines/:id/approve' },
  { method: 'POST', path: '/api/machines/:id/deny' },
  { method: 'POST', path: '/api/machines/:id/revoke' },
  { method: 'PATCH', path: '/api/machines/:id' },
  { method: 'DELETE', path: '/api/machines/:id' },
  { method: 'POST', path: '/api/runner/pair' },
] as const;
