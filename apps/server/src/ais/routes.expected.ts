// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/ais' },
  { method: 'GET', path: '/api/ais/:id' },
  { method: 'POST', path: '/api/ais' },
  { method: 'PATCH', path: '/api/ais/:id' },
  { method: 'DELETE', path: '/api/ais/:id' },
  { method: 'POST', path: '/api/ais/:id/stop' },
  { method: 'POST', path: '/api/ais/:id/resume' },
  { method: 'PUT', path: '/api/ais/:id/machine' },
] as const;
