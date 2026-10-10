// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'PUT', path: '/api/avatars/:kind/:ownerId' },
  { method: 'DELETE', path: '/api/avatars/:kind/:ownerId' },
  { method: 'GET', path: '/api/avatars/:id' },
] as const;
