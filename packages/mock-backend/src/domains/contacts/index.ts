import { defineDomain } from '../domain';
import { handleContacts } from './routes';
import { createContactsState } from './state';

/** Contacts read the shared people seed, plus the removed-id table from T-1237. */
export const contactsDomain = defineDomain({
  name: 'contacts',
  createState: createContactsState,
  routes: handleContacts,
});
