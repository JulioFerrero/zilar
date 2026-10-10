import { defineDomain } from '../domain';
import { handleTools } from './routes';
import { seedToolsAndRuns } from './seed';
import { createToolsState } from './state';

export const toolsDomain = defineDomain({
  name: 'tools',
  seed: seedToolsAndRuns,
  createState: createToolsState,
  routes: handleTools,
});
