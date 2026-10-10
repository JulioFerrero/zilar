// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
import {
  HANDLE_CHECK_MAX,
  HANDLE_CHECK_MIN,
  type BlockedPerson,
  type ContactRequestPerson,
  type ContactRequestRow,
  type ContactRequestStatus,
  type ContactRequestView,
  type HandleCheck,
  type HandleCheckReason,
  type HandleProfile,
} from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

// --- @usernames and contact requests (T-0163) --------------------------------
// Every person has a unique `@username`. Adding someone by handle sends a
// contact request the other person must accept. Handles are stored with the
// typed casing but compared case-insensitively; there is no prefix search.

export type { HandleCheck, HandleCheckReason };

// The server answers a handle outside 1..64 characters with a success body
// (`invalid`), but the derived client encodes the query before it sends it.
// So the same answer is given here, without the round trip.
export function checkHandleKind(handle: string, kind?: 'group'): Promise<HandleCheck> {
  if (handle.length < HANDLE_CHECK_MIN || handle.length > HANDLE_CHECK_MAX) {
    return Promise.resolve({ available: false, reason: 'invalid' });
  }
  return callApi((client) =>
    client.handles.check({ query: kind === undefined ? { handle } : { handle, kind } }),
  );
}

export function checkHandle(handle: string): Promise<HandleCheck> {
  return checkHandleKind(handle);
}

export function claimHandle(handle: string): Promise<{ handle: string }> {
  return callApi((client) => client.handles.claim({ payload: { handle } }));
}

export type ContactRelation =
  'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';

export type {
  ContactRequestPerson,
  ContactRequestRow,
  ContactRequestStatus,
  ContactRequestView,
  HandleProfile,
};

export function lookupByHandle(handle: string): Promise<HandleProfile> {
  return callApi((client) => client.contactRequests.byHandle({ params: { handle } }));
}

export interface ContactRequestList {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
}

export function sendContactRequest(handle: string): Promise<{
  request: ContactRequestRow;
  incoming?: boolean | undefined;
}> {
  return callApi((client) => client.contactRequests.create({ payload: { handle } }));
}

export function listContactRequests(): Promise<ContactRequestList> {
  return callApi((client) => client.contactRequests.list()).then((body) => ({
    incoming: [...body.incoming],
    outgoing: [...body.outgoing],
  }));
}

export function acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return callApi((client) => client.contactRequests.accept({ params: { id } }));
}

export function declineContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return callApi((client) => client.contactRequests.decline({ params: { id } }));
}

export function cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return callApi((client) => client.contactRequests.cancel({ params: { id } }));
}

// --- Blocked people (T-0235) -------------------------------------------------
// Silent blocking: the blocked person is not told, and their contact
// requests never reach the blocker. Writes answer `{ blocked: true/false }`,
// the list answers newest first.

export type { BlockedPerson };

export function blockUser(userId: string): Promise<{ blocked: boolean }> {
  return callApi((client) => client.blocks.block({ params: { userId } }));
}

export function unblockUser(userId: string): Promise<{ blocked: boolean }> {
  return callApi((client) => client.blocks.unblock({ params: { userId } }));
}

export async function listBlockedUsers(): Promise<BlockedPerson[]> {
  const { blocked } = await callApi((client) => client.blocks.list());
  return [...blocked];
}
