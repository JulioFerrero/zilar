// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
import type { Effect } from 'effect';
import {
  type BlockedPerson,
  type ContactRequestResult,
  type ContactRequestRow,
  type HandleProfile,
  type HandleRelation,
  type ZilarClient,
} from '@zilar/api-contract';
import { makeChatsApi } from './chats-api';
export type {
  BlockedPerson,
  Contact,
  ContactRequestList,
  ContactRequestPerson,
  ContactRequestRow,
  ContactRequestStatus,
  ContactRequestView,
  HandleProfile,
} from '@zilar/api-contract';
export type ContactRelation = HandleRelation;
export type CreatedContactRequest = ContactRequestResult & { incoming?: boolean | undefined };
type ContactsCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;
/** The contacts, contact-request and block calls both apps make, over the caller's `call`. */
export function makeContactsApi(call: ContactsCall) {
  const chats = makeChatsApi(call);
  return {
    lookupByHandle: (handle: string): Promise<HandleProfile> =>
      call((client) => client.contactRequests.byHandle({ params: { handle } })),
    // At most 10 people; a leading @ is stripped server-side.
    searchUsers: (q: string): Promise<{ entries: HandleProfile[] }> =>
      call((client) => client.contactRequests.search({ query: { q } })).then((body) => ({
        entries: [...body.entries],
      })),
    sendContactRequest: (handle: string): Promise<CreatedContactRequest> =>
      call((client) => client.contactRequests.create({ payload: { handle } })),
    listContactRequests: () =>
      call((client) => client.contactRequests.list()).then((body) => ({
        incoming: [...body.incoming],
        outgoing: [...body.outgoing],
      })),
    acceptContactRequest: (id: string): Promise<{ request: ContactRequestRow }> =>
      call((client) => client.contactRequests.accept({ params: { id } })),
    declineContactRequest: (id: string): Promise<{ request: ContactRequestRow }> =>
      call((client) => client.contactRequests.decline({ params: { id } })),
    cancelContactRequest: (id: string): Promise<{ request: ContactRequestRow }> =>
      call((client) => client.contactRequests.cancel({ params: { id } })),
    blockUser: (userId: string): Promise<{ blocked: boolean }> =>
      call((client) => client.blocks.block({ params: { userId } })),
    unblockUser: (userId: string): Promise<{ blocked: boolean }> =>
      call((client) => client.blocks.unblock({ params: { userId } })),
    listBlockedUsers: (): Promise<BlockedPerson[]> =>
      call((client) => client.blocks.list()).then(({ blocked }) => [...blocked]),
    listContacts: chats.getContacts,
    removeContact: chats.removeContact,
  };
}
