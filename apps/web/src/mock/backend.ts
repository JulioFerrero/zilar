/**
 * The web half of the shared mock backend (plan task G). `backend` is the one
 * `@zilar/mock-backend` instance for the page load: its HTTP routes and its fake
 * XMPP core read and write the same in-memory seed.
 *
 * `dispatch` is the only seam production code uses. It answers every request the
 * shared backend knows and answers a JSON 404 for any path it does not, like
 * mobile's `mockFetch`, so callers always get a `Response` and never the
 * backend's `undefined`.
 */
import { createMockBackend } from '@zilar/mock-backend';

const backend = createMockBackend();

export { backend };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The shared backend, else a JSON 404; always a `Response`. */
export async function dispatch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await backend.http(path, init);
  if (response !== undefined) {
    return response;
  }
  return jsonResponse({ error: { code: 'not_found', message: `No mock route for ${path}` } }, 404);
}
