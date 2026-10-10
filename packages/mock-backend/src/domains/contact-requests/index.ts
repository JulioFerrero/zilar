import { defineDomain } from '../domain';
import { handleContactRequests } from './routes';
import { seedContactRequestsTable } from './seed';
import { createContactRequestsState } from './state';

export const contactRequestsDomain = defineDomain({
  name: 'contact-requests',
  seed: seedContactRequestsTable,
  createState: createContactRequestsState,
  routes: handleContactRequests,
});
