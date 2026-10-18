import { makeUseAction } from '@zilar/client-core';
import { webAtomRuntime } from '@/lib/effect/runtime';

export { failureOf, isWaiting, shownFailure } from '@zilar/client-core';
export type { ActionControls, ActionMode, ActionState, UseActionOptions } from '@zilar/client-core';

export const useAction = makeUseAction(webAtomRuntime);
