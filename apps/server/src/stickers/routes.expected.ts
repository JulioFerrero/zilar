// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/sticker-packs' },
  { method: 'POST', path: '/api/sticker-packs' },
  { method: 'GET', path: '/api/sticker-packs/discover' },
  { method: 'POST', path: '/api/sticker-packs/import/telegram' },
  { method: 'PATCH', path: '/api/sticker-packs/:id' },
  { method: 'DELETE', path: '/api/sticker-packs/:id' },
  { method: 'DELETE', path: '/api/sticker-packs/:id/stickers/:stickerId' },
  { method: 'PUT', path: '/api/sticker-panel' },
  { method: 'PUT', path: '/api/sticker-panel/:packId' },
  { method: 'DELETE', path: '/api/sticker-panel/:packId' },
  { method: 'GET', path: '/api/sticker-favorites' },
  { method: 'PUT', path: '/api/sticker-favorites' },
  { method: 'DELETE', path: '/api/sticker-favorites' },
  { method: 'POST', path: '/api/sticker-packs/:id/stickers' },
  { method: 'GET', path: '/api/stickers/:stickerId/file' },
] as const;
