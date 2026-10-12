import { defineDomain } from '../domain';
import { handleLinkPreview } from './link-preview';
import { handleMedia } from './routes';

/** Media reads the shared messages seed, so this domain has no table of its own. */
export const mediaDomain = defineDomain({
  name: 'media',
  routes: (data, request) => handleMedia(data, request) ?? handleLinkPreview(request),
});
