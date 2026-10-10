// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/chat-folders' },
  { method: 'POST', path: '/api/chat-folders' },
  { method: 'PUT', path: '/api/chat-folders/order' },
  { method: 'PATCH', path: '/api/chat-folders/:id' },
  { method: 'DELETE', path: '/api/chat-folders/:id' },
] as const;
