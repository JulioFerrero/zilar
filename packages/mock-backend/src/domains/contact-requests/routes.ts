// Contact-requests routes (T-1067): create, list, accept, decline and cancel,
// plus the by-handle lookup, mirroring web's mock
// (`apps/web/src/mock/api.ts:1198-1283`, `:1663-1707`). A create whose other
// side already asked answers 200 `{ request, incoming: true }`; a new one
// answers 201 `{ request }`.

import type { ContactRequestPerson, ContactRequestView } from '@zilar/api-contract';
import { currentUser } from '../../data/people';
import {
  conflict,
  errorResponse,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import type { MockData } from '../../state';
import { handleProfile, handleProfileForId, handleUserId, personHandle } from '../handles/check';
import type { MockContactRequest } from './tables';

export function handleContactRequests(
  data: MockData,
  request: MockHttpRequest,
): Response | undefined {
  const [head, first, second] = request.segments;
  if (head === 'contact-requests') {
    if (first === undefined) {
      if (request.method === 'POST') {
        return createContactRequest(data, request);
      }
      return request.method === 'GET' ? jsonResponse(contactRequestList(data)) : undefined;
    }
    if (request.segments.length === 2 && request.method === 'DELETE') {
      return decideContactRequest(data, decodeURIComponent(first), 'cancelled');
    }
    if (request.segments.length === 3 && request.method === 'POST') {
      if (second === 'accept') {
        return decideContactRequest(data, decodeURIComponent(first), 'accepted');
      }
      if (second === 'decline') {
        return decideContactRequest(data, decodeURIComponent(first), 'declined');
      }
    }
    return undefined;
  }
  if (
    head === 'users' &&
    first === 'by-handle' &&
    second !== undefined &&
    request.segments.length === 3 &&
    request.method === 'GET'
  ) {
    return byHandle(data, decodeURIComponent(second));
  }
  return undefined;
}

function createContactRequest(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const raw = typeof body.handle === 'string' ? body.handle : '';
  const userId = handleUserId(data, raw);
  if (userId === null) {
    return notFound('No user with that username');
  }
  if (userId === currentUser.id) {
    return errorResponse('invalid_request', 'You cannot add yourself');
  }
  const pending = data.contactRequests.find(
    (row) =>
      row.status === 'pending' &&
      ((row.fromUserId === currentUser.id && row.toUserId === userId) ||
        (row.fromUserId === userId && row.toUserId === currentUser.id)),
  );
  if (pending !== undefined) {
    if (pending.fromUserId === currentUser.id) {
      return conflict('request_exists', 'A request is already pending');
    }
    // The other side already asked: 200 with the existing request, so the
    // dialog can offer Accept.
    return jsonResponse({ request: pending, incoming: true }, 200);
  }
  const row: MockContactRequest = {
    id: data.nextContactRequestId(),
    fromUserId: currentUser.id,
    toUserId: userId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  data.putContactRequest(row);
  return jsonResponse({ request: row }, 201);
}

function decideContactRequest(
  data: MockData,
  id: string,
  status: 'accepted' | 'declined' | 'cancelled',
): Response {
  const row = data.findContactRequest(id);
  const mine =
    row !== undefined &&
    (status === 'cancelled' ? row.fromUserId === currentUser.id : row.toUserId === currentUser.id);
  if (row === undefined || !mine || row.status !== 'pending') {
    return notFound('Not found');
  }
  const decided: MockContactRequest = { ...row, status, decidedAt: new Date().toISOString() };
  data.putContactRequest(decided);
  return jsonResponse({ request: decided });
}

function byHandle(data: MockData, handle: string): Response {
  const profile = handleProfile(data, handle);
  if (profile === null) {
    return notFound('No user with that username');
  }
  return jsonResponse(profile);
}

function contactRequestList(data: MockData): {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
} {
  const pending = data.contactRequests
    .filter((row) => row.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return {
    incoming: pending
      .filter((row) => row.toUserId === currentUser.id)
      .map((row) => contactRequestView(data, row)),
    outgoing: pending
      .filter((row) => row.fromUserId === currentUser.id)
      .map((row) => contactRequestView(data, row)),
  };
}

function contactRequestView(data: MockData, row: MockContactRequest): ContactRequestView {
  const otherId = row.fromUserId === currentUser.id ? row.toUserId : row.fromUserId;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    other: contactPerson(data, otherId),
  };
}

/** The other side of a request, like web's `mockContactPerson`. */
function contactPerson(data: MockData, userId: string): ContactRequestPerson {
  const person = data.people.find((entry) => entry.id === userId);
  const profile = userId === currentUser.id ? null : handleProfileForId(userId);
  return {
    userId,
    name: userId === currentUser.id ? data.me.name : (person?.name ?? profile?.name ?? userId),
    handle:
      userId === currentUser.id
        ? (data.me.handle ?? null)
        : person !== undefined
          ? personHandle(data, person.id)
          : (profile?.handle ?? null),
    image: null,
  };
}
