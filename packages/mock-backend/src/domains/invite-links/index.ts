import { defineDomain } from '../domain';
import { handleInviteLinks } from './routes';
import { createInviteLinksState } from './state';

export const inviteLinksDomain = defineDomain({
  name: 'invite-links',
  createState: createInviteLinksState,
  routes: handleInviteLinks,
});
