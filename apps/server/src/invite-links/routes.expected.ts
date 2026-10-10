// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'POST', path: '/api/groups/:id/invite-links' },
  { method: 'GET', path: '/api/groups/:id/invite-links' },
  { method: 'DELETE', path: '/api/groups/:id/invite-links/:linkId' },
  { method: 'GET', path: '/api/join/:token' },
  { method: 'POST', path: '/api/join/:token' },
] as const;
