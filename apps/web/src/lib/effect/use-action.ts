import { makeUseAction } from '@zilar/client-core';
import { webAtomRuntime } from '@/lib/effect/runtime';

export const useAction = makeUseAction(webAtomRuntime);
