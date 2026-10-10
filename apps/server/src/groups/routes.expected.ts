// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'POST', path: '/api/groups' },
  { method: 'GET', path: '/api/groups/:id' },
  { method: 'GET', path: '/api/groups/:id/members' },
  { method: 'PUT', path: '/api/groups/:id/members/:userId/role' },
  { method: 'POST', path: '/api/groups/:id/members' },
  { method: 'DELETE', path: '/api/groups/:id/members/:userId' },
  { method: 'POST', path: '/api/groups/:id/ais' },
  { method: 'DELETE', path: '/api/groups/:id/ais/:aiId' },
  { method: 'PATCH', path: '/api/groups/:id' },
  { method: 'POST', path: '/api/groups/:id/join' },
] as const;
