import { Effect } from 'effect';

import type { ChatStoreState } from '../types';
import { lift, type StoreCtx } from './runtime';

export type PushPairActions = Pick<ChatStoreState, 'setPushPair'>;

export interface PushPair {
  readonly actions: PushPairActions;
}

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
