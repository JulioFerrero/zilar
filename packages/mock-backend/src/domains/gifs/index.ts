import { defineDomain } from '../domain';
import { handleGifs } from './routes';

export const gifsDomain = defineDomain({
  name: 'gifs',
  routes: handleGifs,
});
