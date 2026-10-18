import { makeUseAction } from '@zilar/client-core';
import { mobileAtomRuntime } from '@/lib/effect/runtime';

export { failureOf, isWaiting } from '@zilar/client-core';
export type { ActionControls, ActionMode, ActionState, UseActionOptions } from '@zilar/client-core';

export const useAction = makeUseAction(mobileAtomRuntime);
