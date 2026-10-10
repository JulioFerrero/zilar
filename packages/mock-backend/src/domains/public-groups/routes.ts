// The public-group endpoints (T-0164): the exact `@handle` lookup behind a
// share card and the open join of a public group. Both read the shared group
// registry (`../directory/groups`), so a group the viewer is not in is only
// reachable here; joining appends it to `/chats`.
import type { MockData } from '../../state';
import { errorResponse, jsonResponse, type MockHttpRequest } from '../../http/shared';
import {
  directoryEntryOf,
  findGroup,
  findPublicGroupByHandle,
  joinGroup,
} from '../directory/groups';

export function handlePublicGroups(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head !== 'groups') {
    return undefined;
  }
  if (first === 'by-handle' && second !== undefined && request.method === 'GET') {
    const row = findPublicGroupByHandle(data, decodeURIComponent(second));
    if (row === undefined) {
      return errorResponse('not_found', 'No public group', 404);
    }
    return jsonResponse(directoryEntryOf(row));
  }
  if (second === 'join' && request.method === 'POST') {
    const groupId = decodeURIComponent(first ?? '');
    const row = findGroup(data, groupId);
    if (row === undefined || row.visibility !== 'public') {
      return errorResponse('not_found', 'Group not found', 404);
    }
    const result = joinGroup(data, groupId);
    return jsonResponse(result ?? { groupId, alreadyMember: false });
  }
  return undefined;
}
