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

/** Tries the shared backend first, then the old routes; always a `Response`. */
export async function dispatch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await backend.http(path, init);
  if (response !== undefined) {
    return response;
  }
  return mockRequest(path, init);
}
