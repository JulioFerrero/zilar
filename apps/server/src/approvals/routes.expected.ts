// The routes this module served when it still kept a hand-written manifest.
// `routes-manifest.test.ts` checks them against the routes reflected from the API.
export const EXPECTED_ROUTES = [
  { method: 'GET', path: '/api/approvals' },
  { method: 'GET', path: '/api/approvals/:id' },
  { method: 'POST', path: '/api/approvals/:id/decision' },
  { method: 'GET', path: '/api/ais/:id/approval-rules' },
  { method: 'GET', path: '/api/groups/:id/approval-rules' },
  { method: 'DELETE', path: '/api/approval-rules/:id' },
] as const;
