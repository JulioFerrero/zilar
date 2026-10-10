import { defineDomain } from '../domain';
import { handleMachines } from './routes';
import { seedMachines } from './seed';
import { createMachinesState } from './state';

export const machinesDomain = defineDomain({
  name: 'machines',
  seed: seedMachines,
  createState: createMachinesState,
  routes: handleMachines,
});
