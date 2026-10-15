import { Effect } from 'effect';

import type { ChatStoreState } from '../types';
import { Ports } from './ports';
import { lift, type StoreCtx } from './runtime';

/** The closure helpers of `makeGroups` this action reads (T-1574). */
export interface GroupSettingsHelpers {
  /** Loads a group's detail once; `force` reloads it after a write. */
  readonly ensureGroupDetail: (
    groupId: string,
    force?: boolean,
  ) => Effect.Effect<void, never, Ports>;
  /** A best-effort chat-list refresh: its failure is dropped. */
  readonly refreshQuietly: Effect.Effect<void, never, Ports>;
}

/**
 * The settings write of the group info Settings page (T-1574), located here
 * because `group-actions.ts` is at its file-size limit. It follows the
 * `transferGroupOwner` pattern: call the route, reload the group detail so the
 * page repaints with server truth, then refresh the chat list best-effort.
 * Permissions are enforced by the server; this action never decides them.
 */
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
