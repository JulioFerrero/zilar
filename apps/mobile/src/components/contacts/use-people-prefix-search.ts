import {
  usePeoplePrefixSearch as useSharedPeoplePrefixSearch,
  type PeopleSearchState,
} from '@zilar/client-core';

import type { ContactsApi, HandleProfile } from '@/lib/contacts-api';

export type PeoplePrefixSearchState = PeopleSearchState<HandleProfile>;

export function usePeoplePrefixSearch(api: ContactsApi, query: string): PeoplePrefixSearchState {
  return useSharedPeoplePrefixSearch((q) => api.searchUsers(q), query).state;
}
