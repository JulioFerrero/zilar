import { ApiError, omitUndefined, runApi, type PatchGroupPayload } from '@zilar/api-contract';
import { makeGroupsApi } from '@zilar/client-core';

import { API_URL } from './auth';
import type { GroupMember, TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * The channel management calls (T-0144), the mobile port over the shared
 * groups API (`@zilar/client-core`, `groups-api.ts`, T-2056): create a
 * channel, leave one, read the members slice and flip a member's role, as a
 * Promise port over the client derived from the shared contract
 * (`@zilar/api-contract`, `groups.ts`, T-0892). A malformed payload throws
 * `invalid_response`. Raw server messages never reach the UI; callers map
 * status/code to their own neutral lines.
 */

export type ChannelMemberRole = 'admin' | 'member';

export interface GroupsApi {
  /** Creates a channel (title + optional description ≤ 300, optional public visibility). */
  createChannel(input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }): Promise<{ id: string }>;
  /** Creates a group (title + member ids, no `kind`; optional public visibility). */
  createGroup(input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }): Promise<{ id: string }>;
  /**
   * Reads the members slice for one group: the full audience for
   * owners/admins, the owner/admins slice for channel subscribers (never the
   * audience), 404 for strangers. Rejects on failure.
   */
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  /**
   * Promotes a member to admin or demotes one back (owner only; groups and
   * channels since T-1741, a non-owner sees the same 404 as an unknown id).
   * The last-admin demotion answers 409 `channel_needs_admin`. Rejects on
   * failure.
   */
  changeGroupMemberRole(groupId: string, userId: string, role: ChannelMemberRole): Promise<void>;
  /**
   * Removes one member (owners/admins), or the caller themself to leave.
   * The last-admin removal answers 409 `channel_needs_admin`. Rejects on
   * failure.
   */
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  /**
   * Adds people to a group or channel (owners/admins only, T-1569). The fresh
   * detail the route answers is dropped: the store reloads it. Rejects on
   * failure.
   */
  addGroupMembers(groupId: string, userIds: string[]): Promise<void>;
  /**
   * Adds one of the caller's AIs to a group (owners/admins only, T-1569).
   * Rejects on failure.
   */
  addGroupAi(groupId: string, aiId: string): Promise<void>;
  /**
   * Removes one AI from a group (its owner or a manager, T-1569). Rejects on
   * failure.
   */
  removeGroupAi(groupId: string, aiId: string): Promise<void>;
  /**
   * Hands one group over (T-1190): only the owner, and the target becomes
   * the owner while the caller becomes an admin. Rejects on failure.
   */
  transferGroupOwner(groupId: string, userId: string): Promise<void>;
  /**
   * Deletes one group for everyone (T-1243): only the owner. Every topic
   * room is destroyed. Rejects on failure.
   */
  deleteGroup(groupId: string): Promise<void>;
  /**
   * Patches a group's settings (T-1574): "Members can create topics", the AI
   * listener and eagerness, over `PATCH /api/groups/:id`. Callers send only
   * the keys they set; the payload drops the undefined ones so an untouched
   * field is never cleared. Rejects on failure.
   */
  patchGroupSettings(groupId: string, patch: PatchGroupPayload): Promise<void>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const GroupsApiError = ApiError;
export type GroupsApiError = ApiError;

/** The production `GroupsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createGroupsApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): GroupsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeGroupsApi((call) => runApi(call(client)));
  return {
    // The server trims `title`; the contract encodes the trimmed form.
    createChannel: (input) =>
      runApi(
        client.groups.create({
          payload: {
            title: input.title.trim(),
            kind: 'channel',
            ...(input.description === undefined || input.description.trim() === ''
              ? {}
              : { description: input.description.trim() }),
            // T-0228: visibility and handle go over the wire only on public
            // creates (private requests stay exactly as before).
            ...(input.visibility === 'public' && input.handle !== undefined
              ? { visibility: 'public' as const, handle: input.handle }
              : {}),
          },
        }),
      ).then(({ id }) => ({ id })),
    createGroup: (input) =>
      runApi(
        client.groups.create({
          payload: {
            title: input.title.trim(),
            memberIds: input.memberIds,
            // T-0228: public creates carry the handle in the same step.
            ...(input.visibility === 'public' && input.handle !== undefined
              ? { visibility: 'public' as const, handle: input.handle }
              : {}),
          },
        }),
      ).then(({ id }) => ({ id })),
    // The phone narrows `handle` to absent, so the member row is rebuilt.
    listGroupMembers: (groupId) =>
      api.listGroupMembers(groupId).then((members) =>
        members.map((member) => ({
          userId: member.userId,
          name: member.name,
          role: member.role,
          roles: member.roles ?? [],
        })),
      ),
    changeGroupMemberRole: (groupId, userId, role) =>
      api.changeGroupMemberRole(groupId, userId, role).then(() => undefined),
    removeGroupMember: (groupId, userId) =>
      api.removeGroupMember(groupId, userId).then(() => undefined),
    // T-1569: the fresh detail the route answers is dropped here; the store
    // reloads it through `ensureGroupDetail`, so the cache is one source.
    addGroupMembers: (groupId, userIds) =>
      api.addGroupMembers(groupId, userIds).then(() => undefined),
    addGroupAi: (groupId, aiId) => api.addGroupAi(groupId, aiId).then(() => undefined),
    removeGroupAi: (groupId, aiId) => api.removeGroupAi(groupId, aiId).then(() => undefined),
    // T-1190: the fresh detail the route answers is dropped here; the store
    // reloads it through `ensureGroupDetail`, so the cache is one source.
    transferGroupOwner: (groupId, userId) =>
      api.transferGroupOwner(groupId, userId).then(() => undefined),
    // T-1243: the route answers 204 with no body.
    deleteGroup: (groupId) => api.deleteGroup(groupId),
    // T-1574: only the keys the caller set go over the wire (`omitUndefined`),
    // so a patch of one setting never clears another; the fresh detail the
    // route answers is dropped, the store reloads it.
    patchGroupSettings: async (groupId, patch) => {
      await runApi(client.groups.patch({ params: { id: groupId }, payload: omitUndefined(patch) }));
    },
  };
}
