// useQuery: a read a component shows. The hook lives in `@zilar/client-core`;
// this binds it to the mobile atom runtime.
import { makeUseQuery } from '@zilar/client-core';
import { mobileAtomRuntime } from '@/lib/effect/runtime';

export const useQuery = makeUseQuery(mobileAtomRuntime);
