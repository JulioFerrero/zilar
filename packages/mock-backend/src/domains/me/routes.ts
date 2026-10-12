import type { MockData } from '../../state';
import type { MeState } from './state';
import {
  conflict,
  jsonResponse,
  noContent,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import { checkHandle } from '../handles/check';
import { cancelMockDeletion, mockDeletionStatus, scheduleMockDeletion } from './deletion';
import { mockExport } from './export';
import { listMockSessions, revokeMockSession } from './sessions';

/** `GET`/`PATCH /me` (the display name), `PUT /me/handle` and `/me/sessions`, like web's mock. */
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
  if (first === 'sessions') {
    return handleSessions(data, request);
  }
  if (first === 'deletion') {
    return handleDeletion(data, request);
  }
  if (first === 'export') {
    return request.method === 'GET' && request.segments.length === 2
      ? jsonResponse(mockExport(data))
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
    if (typeof body.bio === 'string') {
      (data as MockData & MeState).setMeBio(body.bio.trim());
    }
    return jsonResponse(data.me);
  }
  return undefined;
}

// `GET /me/sessions` and `DELETE /me/sessions/:id` (T-1250): the mobile Devices
// screen's list and its per-row sign-out. This app is the `current` row.
function handleSessions(data: MockData, request: MockHttpRequest): Response | undefined {
  const id = request.segments[2];
  if (request.segments.length === 2 && request.method === 'GET') {
    return jsonResponse({ sessions: listMockSessions(data) });
  }
  if (request.segments.length === 3 && request.method === 'DELETE' && id !== undefined) {
    revokeMockSession(data, id);
    return noContent();
  }
  return undefined;
}

// `GET`/`POST`/`DELETE /me/deletion` (T-1261): read the 7-day grace, schedule
// it or cancel it, all in memory. No session is deleted here.
function handleDeletion(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 2) {
    return undefined;
  }
  if (request.method === 'GET') {
    return jsonResponse(mockDeletionStatus(data));
  }
  if (request.method === 'POST') {
    return jsonResponse(scheduleMockDeletion(data));
  }
  if (request.method === 'DELETE') {
    return jsonResponse(cancelMockDeletion(data));
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
  // The me state's setter copies the row, so the handle survives a later rename.
  data.setMeHandle(raw);
  return jsonResponse({ handle: raw });
}
