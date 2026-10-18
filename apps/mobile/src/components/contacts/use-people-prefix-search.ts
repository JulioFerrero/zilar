import {
  usePeoplePrefixSearch as useSharedPeoplePrefixSearch,
  type PeopleSearchState,
} from '@zilar/client-core';

import type { ContactsApi, HandleProfile } from '@/lib/contacts-api';

export type PeoplePrefixSearchState = PeopleSearchState<HandleProfile>;

/**
 * The phone's people prefix search for the chat-list search bar (T-1668): a
 * thin adapter over the shared `usePeoplePrefixSearch` in client-core. Any
 * query of 3+ characters (after one leading `@`) is debounced and looked up
 * through `GET /users/search`.
 */
export function usePeoplePrefixSearch(api: ContactsApi, query: string): PeoplePrefixSearchState {
  return useSharedPeoplePrefixSearch((q) => api.searchUsers(q), query).state;
}
