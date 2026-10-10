import { bareJid } from '@zilar/protocol';
import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The contacts API (`/api/users/by-handle/:handle`, `/api/contact-requests`
 * and `/api/blocks`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `packages/api-contract/src/contact-requests.ts` and `blocks.ts` (T-0894);
 * the client is derived from it. `ContactsApiError` is the shared `ApiError`,
 * so screens can branch on the server's `code` and `status` without parsing
 * the message again (404 = unknown handle, 429 = rate limited).
 */

export type ContactRelation =
  'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';

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
  /** Present when the other side already asked: offer Accept, not a second row. */
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
  sendContactRequest(handle: string): Promise<CreatedContactRequest>;
  listContactRequests(): Promise<ContactRequestList>;
  acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  declineContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  blockUser(userId: string): Promise<{ blocked: boolean }>;
  unblockUser(userId: string): Promise<{ blocked: boolean }>;
  listBlockedUsers(): Promise<BlockedPerson[]>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const ContactsApiError = ApiError;
export type ContactsApiError = ApiError;

/**
 * Normalizes a typed @handle for lookup: strips a leading @, trims
 * whitespace, lowercases. The server compares case-insensitively, so the
 * lookup sends the normalized form.
 */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/**
 * The domain part of a bare JID (`ana@zilar.test` -> `zilar.test`).
 * Returns undefined for anything that is not a bare user JID.
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
 * The DM chat id for a contact: the server builds it from the user's id
 * lowercased plus the XMPP domain (`localpartFor` + `jidFor` in
 * `apps/server/src/xmpp/provisioning.ts`). Normal ids are alphanumeric, so
 * lowercasing is the whole mapping; ids that would need the server's hash
 * fallback resolve to a chat that does not exist and the caller falls back
 * to the chats list.
 */
export function contactChatId(userId: string, domain: string): string {
  return `${userId.toLowerCase()}@${domain}`;
}

/** The production `ContactsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createContactsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ContactsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    lookupByHandle: (handle) => runApi(client.contactRequests.byHandle({ params: { handle } })),
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
  };
}
