// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/gifs/search' },
  { method: 'GET', path: '/api/gifs/trending' },
  { method: 'GET', path: '/api/gifs/media/:token' },
] as const;
