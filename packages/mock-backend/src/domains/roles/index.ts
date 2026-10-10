import { defineDomain } from '../domain';
import { handleRoles } from './routes';
import { seedRoles } from './seed';
import { createRolesState } from './state';

export const rolesDomain = defineDomain({
  name: 'roles',
  seed: seedRoles,
  createState: createRolesState,
  routes: handleRoles,
});
