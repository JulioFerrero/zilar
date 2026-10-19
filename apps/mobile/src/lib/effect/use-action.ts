import { makeUseAction } from '@zilar/client-core';
import { mobileAtomRuntime } from '@/lib/effect/runtime';

export const useAction = makeUseAction(mobileAtomRuntime);
