import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import type { GroupMember, TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * The channel management calls (T-0144), the mobile twin of the web channel
 * client (`apps/web/src/lib/api.ts`, "Channels"): create a channel, leave
 * one, read the members slice and flip a member's role, as a Promise port over
 * the client derived from the shared contract (`@zilar/api-contract`,
 * `groups.ts`, T-0892). A malformed payload throws `invalid_response`. Raw
 * server messages never reach the UI; callers map status/code to their own
 * neutral lines.
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
   * Promotes a subscriber to admin or demotes one back (owner only,
   * channels only — plain groups answer the same 404 as an unknown id).
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
    listGroupMembers: (groupId) =>
      runApi(client.groups.members({ params: { id: groupId } })).then(({ members }) =>
        members.map((member) => ({
          userId: member.userId,
          name: member.name,
          role: member.role,
          roles: member.roles ?? [],
        })),
      ),
    changeGroupMemberRole: async (groupId, userId, role) => {
      await runApi(
        client.groups.changeRole({ params: { id: groupId, userId }, payload: { role } }),
      );
    },
    removeGroupMember: async (groupId, userId) => {
      await runApi(client.groups.removeMember({ params: { id: groupId, userId } }));
    },
  };
}
