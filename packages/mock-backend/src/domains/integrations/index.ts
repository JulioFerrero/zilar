import { defineDomain } from '../domain';
import { handleIntegrations } from './routes';
import { seedIntegrations } from './seed';
import { createIntegrationsState } from './state';

export const integrationsDomain = defineDomain({
  name: 'integrations',
  seed: seedIntegrations,
  createState: createIntegrationsState,
  routes: handleIntegrations,
});
