// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'POST', path: '/api/contact-requests' },
  { method: 'GET', path: '/api/contact-requests' },
  { method: 'POST', path: '/api/contact-requests/:id/accept' },
  { method: 'POST', path: '/api/contact-requests/:id/decline' },
  { method: 'DELETE', path: '/api/contact-requests/:id' },
  { method: 'GET', path: '/api/users/by-handle/:handle' },
] as const;
