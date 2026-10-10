import type { MockData } from '../state';
import { jsonResponse, readJsonBody, type MockHttpRequest } from './shared';

/** `GET /me` and `PATCH /me` (the display name), like web's mock. */
export function handleMe(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'me') {
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
