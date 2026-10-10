// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/ais/:id/routines' },
  { method: 'GET', path: '/api/groups/:id/routines' },
  { method: 'POST', path: '/api/routines/:id/pause' },
  { method: 'POST', path: '/api/routines/:id/resume' },
  { method: 'DELETE', path: '/api/routines/:id' },
] as const;
