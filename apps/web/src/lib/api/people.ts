// effect-plain: the promise edge over the Effect client.
import {
  type BlockedPerson,
  type ContactRequestPerson,
  type ContactRequestRow,
  type ContactRequestStatus,
  type ContactRequestView,
  type HandleProfile,
} from '@zilar/api-contract';
import { makeHandlesApi } from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';

// Handles are stored with the typed casing but compared case-insensitively; there is no
// prefix search.

export type { HandleCheck, HandleCheckReason } from '@zilar/client-core';

const handles = makeHandlesApi(callApi);
export const { checkHandleKind, checkHandle, claimHandle } = handles;

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

// At most 10 people; a leading @ is stripped server-side.
export function searchUsers(q: string): Promise<{ entries: HandleProfile[] }> {
  return callApi((client) => client.contactRequests.search({ query: { q } })).then((body) => ({
    entries: [...body.entries],
  }));
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

// Silent blocking: the blocked person is not told and their requests never reach the blocker;
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
