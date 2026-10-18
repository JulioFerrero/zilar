import { Effect } from 'effect';

import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { lift, type StoreCtx } from './runtime';

export interface GroupSettingsHelpers {
  readonly ensureGroupDetail: (
    groupId: string,
    force?: boolean,
  ) => Effect.Effect<void, never, Ports>;
  readonly refreshQuietly: Effect.Effect<void, never, Ports>;
}

/** Permissions are enforced by the server; this action never decides them. */
export type GroupSettingsActions = Pick<ChatStoreState, 'patchGroupSettings'>;

export function makeGroupSettingsActions(
  ctx: StoreCtx,
  helpers: GroupSettingsHelpers,
): GroupSettingsActions {
  const { groups: groupsApi } = ctx.ports;
  const { ensureGroupDetail, refreshQuietly } = helpers;

  return {
    patchGroupSettings: (groupId, patch) =>
      ctx.run(
        Effect.gen(function* () {
          yield* lift(() => groupsApi.patchGroupSettings(groupId, patch));
          yield* ensureGroupDetail(groupId, true);
          yield* refreshQuietly;
        }),
      ),
  };
}
