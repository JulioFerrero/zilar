import { bareJid } from '@zilar/protocol';
import { ApiError, runApi, type Contact } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * `ContactsApiError` is the shared `ApiError`, so screens branch on `code` and `status` without parsing the message (404 = unknown handle, 429 = rate limited).
 */

export type ContactRelation =
  'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';

export type { Contact };

export interface HandleProfile {
  userId: string;
  name: string;
  handle: string;
  image: string | null;
  relation: ContactRelation;
}

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface ContactRequestPerson {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
}

export interface ContactRequestView {
  id: string;
  status: ContactRequestStatus;
  createdAt: string;
  other: ContactRequestPerson;
}

export interface ContactRequestList {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
}

export interface ContactRequestRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: ContactRequestStatus;
  createdAt: string;
  decidedAt?: string | undefined;
}

export interface CreatedContactRequest {
  request: ContactRequestRow;
  incoming?: boolean | undefined;
}

export interface BlockedPerson {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
  jid: string | null;
}

export interface ContactsApi {
  lookupByHandle(handle: string): Promise<HandleProfile>;
  searchUsers(q: string): Promise<HandleProfile[]>;
  sendContactRequest(handle: string): Promise<CreatedContactRequest>;
  listContactRequests(): Promise<ContactRequestList>;
  acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  declineContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  blockUser(userId: string): Promise<{ blocked: boolean }>;
  unblockUser(userId: string): Promise<{ blocked: boolean }>;
  listBlockedUsers(): Promise<BlockedPerson[]>;
  listContacts(): Promise<Contact[]>;
  removeContact(userId: string): Promise<void>;
}

export const ContactsApiError = ApiError;
export type ContactsApiError = ApiError;

/**
 * The server compares case-insensitively, so the lookup sends the trimmed, lowercased form without a leading @.
 */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/**
 * The domain part of a bare user JID, or undefined for anything else.
 */
export function domainOfJid(jid: string | null | undefined): string | undefined {
  if (typeof jid !== 'string') return undefined;
  const bare = bareJid(jid);
  const parts = bare.split('@');
  if (parts.length !== 2) return undefined;
  const domain = parts[1] ?? '';
  return domain === '' ? undefined : domain;
}

/**
 * The server builds it from the lowercased user id plus the XMPP domain; an id that needs the server's hash fallback resolves to a chat that does not exist, and the caller falls back to the chats list.
 */
export function contactChatId(userId: string, domain: string): string {
  return `${userId.toLowerCase()}@${domain}`;
}

export function createContactsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ContactsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    lookupByHandle: (handle) => runApi(client.contactRequests.byHandle({ params: { handle } })),
    searchUsers: (q) =>
      runApi(client.contactRequests.search({ query: { q } })).then((body) => [...body.entries]),
    sendContactRequest: (handle) => runApi(client.contactRequests.create({ payload: { handle } })),
    listContactRequests: () =>
      runApi(client.contactRequests.list()).then((body) => ({
        incoming: [...body.incoming],
        outgoing: [...body.outgoing],
      })),
    acceptContactRequest: (id) => runApi(client.contactRequests.accept({ params: { id } })),
    declineContactRequest: (id) => runApi(client.contactRequests.decline({ params: { id } })),
    cancelContactRequest: (id) => runApi(client.contactRequests.cancel({ params: { id } })),
    blockUser: (userId) => runApi(client.blocks.block({ params: { userId } })),
    unblockUser: (userId) => runApi(client.blocks.unblock({ params: { userId } })),
    listBlockedUsers: () => runApi(client.blocks.list()).then((body) => [...body.blocked]),
    listContacts: () => runApi(client.contacts.list()).then((rows) => [...rows]),
    removeContact: (userId) =>
      runApi(client.contacts.remove({ params: { userId } })).then(() => undefined),
  };
}
