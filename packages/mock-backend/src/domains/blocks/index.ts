import { defineDomain } from '../domain';
import { handleBlocks } from './routes';
import { seedBlocksTable } from './seed';
import { createBlocksState } from './state';

export const blocksDomain = defineDomain({
  name: 'blocks',
  seed: seedBlocksTable,
  createState: createBlocksState,
  routes: handleBlocks,
});
