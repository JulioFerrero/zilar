/**
 * The web half of the shared mock backend (plan task G). `backend` is the one
 * `@zilar/mock-backend` instance for the page load: its HTTP routes and its fake
 * XMPP core read and write the same in-memory seed.
 *
 * `dispatch` is the migration seam. It answers every request the shared backend
 * knows and falls back to the old hand-written routes in `mock/api.ts` for the
 * domains the sweep tasks have not moved over yet. Both paths return a
 * `Response`, so callers never see the backend's `undefined`.
 */
import { createMockBackend } from '@zilar/mock-backend';
import { mockRequest } from './api';

const backend = createMockBackend();

export { backend };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The real store asks for an XMPP token before it opens the core. The shared
// backend has no `/xmpp/token` route yet, so the web dispatcher answers it with
// a fixed token; the fake core ignores the token, and `service`/`domain` only
// feed the media allow-list.
const MOCK_XMPP_TOKEN = {
  jid: 'you@zilar.test',
  token: 'mock-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  service: 'wss://mock.zilar.test/xmpp-ws/ws',
  domain: 'zilar.test',
  mucDomain: 'rooms.zilar.test',
};

function isXmppTokenPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? '';
  return pathname === '/xmpp/token' || pathname === '/api/xmpp/token';
}

/** Tries the shared backend first, then the old routes; always a `Response`. */
export async function dispatch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await backend.http(path, init);
  if (response !== undefined) {
    return response;
  }
  // A gap the backend lacks yet: the token the real store needs to open the
  // fake XMPP core. If the backend grows a route for it, that route wins above.
  if (isXmppTokenPath(path)) {
    return jsonResponse(MOCK_XMPP_TOKEN);
  }
  return mockRequest(path, init);
}
