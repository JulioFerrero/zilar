import { makeUseAction } from '@zilar/client-core';
import { mobileAtomRuntime } from '@/lib/effect/runtime';

export { isWaiting } from '@zilar/client-core';

export const useAction = makeUseAction(mobileAtomRuntime);
