import { makeUseQuery } from '@zilar/client-core';
import { mobileAtomRuntime } from '@/lib/effect/runtime';

export const useQuery = makeUseQuery(mobileAtomRuntime);
