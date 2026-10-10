import type { Contact } from '@zilar/api-contract';
import type { MockData } from '../state';
import { jsonResponse, type MockHttpRequest } from './shared';

/** `GET /contacts`: every seed person, like web's mock. */
export function handleContacts(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'contacts') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  return jsonResponse(contactsOf(data));
}

function contactsOf(data: MockData): readonly Contact[] {
  return data.people.map((person) => ({
    userId: person.id,
    name: person.name,
    jid: person.jid,
  }));
}
