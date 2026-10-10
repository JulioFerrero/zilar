import { defineDomain } from '../domain';
import { handlePush } from './routes';
import { seedPush } from './seed';
import { createPushState } from './state';

export const pushDomain = defineDomain({
  name: 'push',
  seed: seedPush,
  createState: createPushState,
  routes: handlePush,
});
