import { defineDomain } from '../domain';
import { handleRoutines } from './routes';
import { seedRoutinesTable } from './seed';
import { createRoutinesState } from './state';

export const routinesDomain = defineDomain({
  name: 'routines',
  seed: seedRoutinesTable,
  createState: createRoutinesState,
  routes: handleRoutines,
});
