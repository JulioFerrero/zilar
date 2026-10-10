import { defineDomain } from '../domain';
import { handleMedia } from './routes';

/** Media reads the shared messages seed, so this domain has no table of its own. */
export const mediaDomain = defineDomain({
  name: 'media',
  routes: handleMedia,
});
