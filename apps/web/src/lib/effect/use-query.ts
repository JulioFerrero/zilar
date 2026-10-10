// useQuery: a read a component shows. The hook lives in `@zilar/client-core`;
// this binds it to the web atom runtime.
import { makeUseQuery } from '@zilar/client-core';
import { webAtomRuntime } from '@/lib/effect/runtime';

export const useQuery = makeUseQuery(webAtomRuntime);
