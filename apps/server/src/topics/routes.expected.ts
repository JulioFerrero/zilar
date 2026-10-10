// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/groups/:id/topics' },
  { method: 'POST', path: '/api/groups/:id/topics' },
  { method: 'GET', path: '/api/topics/:id' },
  { method: 'PATCH', path: '/api/topics/:id' },
  { method: 'POST', path: '/api/topics/:id/archive' },
  { method: 'GET', path: '/api/topics/:id/members' },
  { method: 'POST', path: '/api/topics/:id/members' },
  { method: 'DELETE', path: '/api/topics/:id/members/:userId' },
  { method: 'PUT', path: '/api/topics/:id/roles' },
  { method: 'GET', path: '/api/topics/:id/ais' },
  { method: 'POST', path: '/api/topics/:id/ais' },
  { method: 'DELETE', path: '/api/topics/:id/ais/:aiId' },
] as const;
