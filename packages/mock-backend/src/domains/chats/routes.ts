import type { MockData } from '../../state';
import { jsonResponse, type MockHttpRequest } from '../../http/shared';

/** `GET /chats`: the seed's entries, the `ChatEntry[]` shape the apps map. */
export function handleChats(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'chats') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  return jsonResponse({ chats: data.chats });
}
