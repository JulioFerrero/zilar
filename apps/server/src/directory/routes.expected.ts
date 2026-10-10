// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/directory' },
  { method: 'GET', path: '/api/groups/by-handle/:handle' },
] as const;
