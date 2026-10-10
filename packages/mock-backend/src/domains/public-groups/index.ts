import { defineDomain } from '../domain';
import { handlePublicGroups } from './routes';

export const publicGroupsDomain = defineDomain({
  name: 'public-groups',
  routes: handlePublicGroups,
});
