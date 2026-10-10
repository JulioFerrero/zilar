// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'PUT', path: '/api/blocks/:userId' },
  { method: 'DELETE', path: '/api/blocks/:userId' },
  { method: 'GET', path: '/api/blocks' },
] as const;
