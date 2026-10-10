import { defineDomain } from '../domain';
import { handlePins } from './routes';
import { seedPinsTable } from './seed';
import { createPinsState } from './state';

export const pinsDomain = defineDomain({
  name: 'pins',
  seed: seedPinsTable,
  createState: createPinsState,
  routes: handlePins,
});
