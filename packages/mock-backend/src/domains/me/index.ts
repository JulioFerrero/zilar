import { defineDomain } from '../domain';
import { handleMe } from './routes';
import { seedMe } from './seed';
import { createMeState } from './state';

export const meDomain = defineDomain({
  name: 'me',
  seed: seedMe,
  createState: createMeState,
  routes: handleMe,
});
