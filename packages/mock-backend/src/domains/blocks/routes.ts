// Blocks routes (T-1067): block, unblock and list, mirroring web's mock
// (`apps/web/src/mock/api.ts:1709-1734`). Blocking is silent and idempotent;
// an unknown user id answers 404, while unblocking an unknown person succeeds.

import type { BlockedPerson } from '@zilar/api-contract';
import { currentUser } from '../../data/people';
import { jsonResponse, notFound, type MockHttpRequest } from '../../http/shared';
import type { MockData } from '../../state';
import { handleProfileForId, personHandle } from '../handles/check';

export function handleBlocks(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head !== 'blocks') {
    return undefined;
  }
  if (first === undefined) {
    return request.method === 'GET' ? jsonResponse({ blocked: blockedList(data) }) : undefined;
  }
  if (second !== undefined) {
    return undefined;
  }
  const userId = decodeURIComponent(first);
  if (request.method === 'PUT') {
    return block(data, userId);
  }
  if (request.method === 'DELETE') {
    data.unblockUser(userId);
    return jsonResponse({ blocked: false });
  }
  return undefined;
}

function block(data: MockData, userId: string): Response {
  if (!isKnownUser(data, userId)) {
    return notFound('No user with that id');
  }
  data.blockUser(userId);
  return jsonResponse({ blocked: true });
}

/** Web's known-user rule: the viewer, a seed person, or a synthetic handle id. */
function isKnownUser(data: MockData, userId: string): boolean {
  return (
    userId === currentUser.id ||
    data.people.some((entry) => entry.id === userId) ||
    userId.startsWith('u-handle-')
  );
}

function blockedList(data: MockData): readonly BlockedPerson[] {
  const ordered = [...data.blockedUsers].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt));
  return ordered.map((entry) => {
    const profile = handleProfileForId(entry.userId);
    const person = data.people.find((item) => item.id === entry.userId);
    return {
      userId: entry.userId,
      name: person?.name ?? profile?.name ?? entry.userId,
      handle: personHandle(data, entry.userId) ?? profile?.handle ?? null,
      image: null,
      jid: entry.userId === currentUser.id ? (data.me.jid ?? null) : `${entry.userId}@zilar.test`,
    };
  });
}
