import { defineDomain } from '../domain';
import { handleSearch } from './routes';

/** Search reads the message seed and the shared people, so it has no table. */
export const searchDomain = defineDomain({
  name: 'search',
  routes: handleSearch,
});
