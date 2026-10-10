/**
 * The mobile half of the shared mock backend (plan task H). `backend` is the one
 * `@zilar/mock-backend` instance for the app run: its HTTP routes and its fake
 * XMPP core read and write the same in-memory seed.
 *
 * `mockFetch` is the migration seam. The real store's API factories call
 * `${API_URL}/api/...` through `fetch`, so it strips the origin and asks the
 * shared backend. Unlike the web dispatcher there is no request-level fallback:
 * mobile's old mocks are not HTTP, so a path the backend does not serve answers
 * a 404. This module is only `require`d behind the mock build condition, so a
 * release build carries none of it.
 */
import { createMockBackend, defaultSeed } from '@zilar/mock-backend';

const backend = createMockBackend();

/** The seeded viewer's id; mock mode signs nobody in, so owner checks use this. */
export const mockViewerId: string = defaultSeed.me.id;

export { backend };

/** The URL's path and query, with the origin dropped (`http://host/x` -> `/x`). */
function pathAndQuery(url: string): string {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) {
    return url;
  }
  const pathStart = url.indexOf('/', schemeEnd + 3);
  return pathStart === -1 ? '/' : url.slice(pathStart);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The `fetch` the mock-mode API factories use: the shared backend, else 404. */
export const mockFetch: typeof fetch = async (input, init = {}) => {
  const path = pathAndQuery(String(input));
  const response = await backend.http(path, init);
  if (response !== undefined) {
    return response;
  }
  return jsonResponse({ error: { code: 'not_found', message: `No mock route for ${path}` } }, 404);
};
