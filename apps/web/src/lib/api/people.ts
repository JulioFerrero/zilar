// effect-plain: the promise edge over the Effect client.
import { makeContactsApi, makeHandlesApi } from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';
// Handles are stored with the typed casing but compared case-insensitively; there is no prefix search.
export type {
  BlockedPerson,
  ContactRelation,
  ContactRequestList,
  ContactRequestPerson,
  ContactRequestRow,
  ContactRequestStatus,
  ContactRequestView,
  HandleCheck,
  HandleCheckReason,
  HandleProfile,
} from '@zilar/client-core';

export const { checkHandleKind, checkHandle, claimHandle } = makeHandlesApi(callApi);

const contacts = makeContactsApi(callApi);
export const { lookupByHandle, searchUsers, sendContactRequest, listContactRequests } = contacts;
export const { acceptContactRequest, declineContactRequest, cancelContactRequest } = contacts;
export const { blockUser, unblockUser, listBlockedUsers } = contacts;
