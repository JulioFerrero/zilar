import { Effect } from 'effect';

import type { ChatStoreState } from '../types';
import { lift, type StoreCtx } from './runtime';

export type PushPairActions = Pick<ChatStoreState, 'setPushPair'>;

export interface PushPair {
  readonly actions: PushPairActions;
}

/**
 * Toggles the XEP-0357 push pair over the user's own session (T-1139), the
 * mobile twin of the web `setPushPair` (`apps/web/src/store/effects/pins.ts`).
 * Fails when the chat connection is missing or cannot send raw IQs, so the
 * caller can roll back.
 */
export function makePushPair(ctx: StoreCtx): PushPair {
  return {
    actions: {
      setPushPair: (input) =>
        ctx.run(
          Effect.suspend(() => {
            const core = ctx.s.core;
            if (core === undefined || core.setPushEnabled === undefined) {
              return Effect.fail(new Error('the chat connection cannot toggle push'));
            }
            const setPushEnabled = core.setPushEnabled.bind(core);
            return lift(() => setPushEnabled(input));
          }),
        ),
    },
  };
}
