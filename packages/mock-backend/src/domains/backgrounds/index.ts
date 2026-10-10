import { defineDomain } from '../domain';
import { handleBackgrounds } from './routes';
import { createBackgroundsState } from './state';

export const backgroundsDomain = defineDomain({
  name: 'backgrounds',
  createState: createBackgroundsState,
  routes: handleBackgrounds,
});
