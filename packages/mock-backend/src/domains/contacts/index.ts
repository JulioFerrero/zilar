import { defineDomain } from '../domain';
import { handleContacts } from './routes';

/** Contacts read the shared people seed, so this domain has no table of its own. */
export const contactsDomain = defineDomain({
  name: 'contacts',
  routes: handleContacts,
});
