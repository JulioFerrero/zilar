import type { MockData } from '../../state';
import { conflict, jsonResponse, readJsonBody, type MockHttpRequest } from '../../http/shared';
import { checkHandle } from '../handles/check';

/** `GET`/`PATCH /me` (the display name) and `PUT /me/handle`, like web's mock. */
export function handleMe(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first] = request.segments;
  if (head !== 'me') {
    return undefined;
  }
  if (first === 'handle') {
    return request.segments.length === 2 && request.method === 'PUT'
      ? putMeHandle(data, request)
      : undefined;
  }
  if (first !== undefined) {
    return undefined;
  }
  if (request.method === 'GET') {
    return jsonResponse(data.me);
  }
  if (request.method === 'PATCH') {
    const body = readJsonBody(request.init);
    if (typeof body.name === 'string' && body.name.trim() !== '') {
      data.renameMe(body.name.trim());
    }
    return jsonResponse(data.me);
  }
  return undefined;
}

// Claiming a handle mirrors web's mock: shape and reserved words come from the
// shared rules, `taken_user` is always taken, and every failure answers 409 with
// a code the apps' error mapping knows.
function putMeHandle(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const raw = typeof body.handle === 'string' ? body.handle.trim() : '';
  const checked = checkHandle(raw);
  if (!checked.available) {
    const code =
      checked.reason === 'invalid'
        ? 'handle_invalid'
        : checked.reason === 'reserved'
          ? 'handle_reserved'
          : 'handle_taken';
    return conflict(code, 'That username is not available');
  }
  // The me state exposes no handle setter, so the claim writes the viewer row
  // in place; `renameMe` copies the row, so the handle survives a later rename.
  Object.assign(data.me, { handle: raw });
  return jsonResponse({ handle: raw });
}
