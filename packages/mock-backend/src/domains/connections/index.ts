import { defineDomain } from '../domain';
import { handleConnections } from './routes';
import { seedConnections } from './seed';
import { createConnectionsState } from './state';

export const connectionsDomain = defineDomain({
  name: 'connections',
  seed: seedConnections,
  createState: createConnectionsState,
  routes: handleConnections,
});
