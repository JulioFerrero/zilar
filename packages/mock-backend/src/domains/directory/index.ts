import { defineDomain } from '../domain';
import { handleDirectory } from './routes';

export const directoryDomain = defineDomain({
  name: 'directory',
  routes: handleDirectory,
});
