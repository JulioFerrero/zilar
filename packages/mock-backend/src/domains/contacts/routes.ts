import type { Contact } from '@zilar/api-contract';
import type { MockData } from '../../state';
import { jsonResponse, noContent, notFound, type MockHttpRequest } from '../../http/shared';

/**
 * `GET /contacts`: every seed person still on the caller's list, like web's
 * mock. `DELETE /contacts/:userId` (T-1237): drops one from the mock store and
 * answers 204, or 404 when the id is not a contact (unknown, or removed
 * already), so Remove works in mock mode on web and mobile.
 */
export function handleContacts(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, second] = request.segments;
  if (head !== 'contacts' || request.segments.length > 2) {
    return undefined;
  }
  if (second === undefined) {
    return request.method === 'GET' ? jsonResponse(contactsOf(data)) : undefined;
  }
  if (request.method !== 'DELETE') {
    return undefined;
  }
  return removeContact(data, decodeURIComponent(second));
}

function removeContact(data: MockData, userId: string): Response {
  if (!isContact(data, userId)) {
    return notFound('No contact with that id');
  }
  data.removeContact(userId);
  return noContent();
}

function isContact(data: MockData, userId: string): boolean {
  return data.isContact(userId) && data.people.some((person) => person.id === userId);
}

function contactsOf(data: MockData): readonly Contact[] {
  return data.people
    .filter((person) => data.isContact(person.id))
    .map((person) => ({
      userId: person.id,
      name: person.name,
      jid: person.jid,
    }));
}
