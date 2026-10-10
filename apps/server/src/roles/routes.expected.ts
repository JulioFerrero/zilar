// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/groups/:id/roles' },
  { method: 'POST', path: '/api/groups/:id/roles' },
  { method: 'PATCH', path: '/api/groups/:id/roles/:roleId' },
  { method: 'DELETE', path: '/api/groups/:id/roles/:roleId' },
  { method: 'PUT', path: '/api/groups/:id/roles/:roleId/members' },
] as const;
