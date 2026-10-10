// useAction: the one way a component runs a user action. The hook lives in
// `@zilar/client-core`; this binds it to the web atom runtime.
import { makeUseAction } from '@zilar/client-core';
import { webAtomRuntime } from '@/lib/effect/runtime';

export { failureOf, isWaiting } from '@zilar/client-core';
export type { ActionControls, ActionMode, ActionState, UseActionOptions } from '@zilar/client-core';

export const useAction = makeUseAction(webAtomRuntime);
