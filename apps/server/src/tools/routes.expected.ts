// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/ais/:id/tools' },
  { method: 'GET', path: '/api/groups/:id/tools' },
  { method: 'GET', path: '/api/topics/:id/tools' },
  { method: 'GET', path: '/api/tools/:id' },
  { method: 'GET', path: '/api/tools/:id/versions' },
  { method: 'GET', path: '/api/tools/:id/versions/:n' },
  { method: 'GET', path: '/api/tools/:id/runs' },
  { method: 'POST', path: '/api/tools/:id/revert' },
  { method: 'DELETE', path: '/api/tools/:id' },
  { method: 'POST', path: '/api/tools/:id/run' },
] as const;
