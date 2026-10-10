import { defineDomain } from '../domain';
import { handleAis } from './routes';
import { seedAis } from './seed';
import { createAisState } from './state';

export const aisDomain = defineDomain({
  name: 'ais',
  seed: seedAis,
  createState: createAisState,
  routes: handleAis,
});
