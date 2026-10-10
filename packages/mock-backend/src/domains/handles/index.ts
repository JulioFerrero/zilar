import { defineDomain } from '../domain';
import { handleHandles } from './routes';

/** Handles read no table: the check is pure, and the claim writes the `me` row. */
export const handlesDomain = defineDomain({
  name: 'handles',
  routes: handleHandles,
});
