import { defineDomain } from '../domain';
import { handleGroups } from './routes';
import { seedGroups } from './seed';
import { createGroupsState } from './state';

export const groupsDomain = defineDomain({
  name: 'groups',
  seed: seedGroups,
  createState: createGroupsState,
  routes: handleGroups,
});
