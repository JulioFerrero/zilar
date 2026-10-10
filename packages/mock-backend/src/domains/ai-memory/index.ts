import { defineDomain } from '../domain';
import { handleAiMemory } from './routes';
import { createAiMemoryState } from './state';

/** AI memory is seeded lazily per key, so this domain contributes no seed rows. */
export const aiMemoryDomain = defineDomain({
  name: 'ai-memory',
  createState: createAiMemoryState,
  routes: handleAiMemory,
});
