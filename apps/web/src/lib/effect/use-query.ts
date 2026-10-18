import { makeUseQuery } from '@zilar/client-core';
import { webAtomRuntime } from '@/lib/effect/runtime';

export const useQuery = makeUseQuery(webAtomRuntime);
