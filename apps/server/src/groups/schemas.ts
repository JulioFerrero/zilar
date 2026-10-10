import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { GROUP_MEMBERS_MAX } from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { GroupVisibility } from './visibility';

// The `removeGroupAi` transaction below runs on the `effect/sql` client
// registered for this database (see `../effect/sql`), through the phase-1
// Effects of the rules, tools, routines and memory helpers.
export const MAX_GROUP_MEMBERS = GROUP_MEMBERS_MAX;
export const ROOM_LOCALPART_LENGTH = 16;

export const ROOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const ROOM_ROLES = { owner: 0, admin: 1, member: 2 } as const;

export type GroupRole = 'owner' | 'admin' | 'member';

// Minimal slice of pino's Logger the invite sending needs.
export interface InviteLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface GroupMemberView {
  userId: string;
  name: string;
  role: GroupRole;
  /** T-0116: the custom group roles this member holds. */
  roles: Array<{ id: string; name: string }>;
  /** T-0163: the member's `@username`, when they have one. */
  handle?: string | null | undefined;
  /** T-0165: the member's picture, when they have one. Omitted when none. */
  avatarUrl?: string | undefined;
}

export type ChannelKind = 'group' | 'channel';

// T-0474: how readily a group's listener speaks (plan §8, decision 2).
export type GroupListenerEagerness = 'quiet' | 'normal' | 'eager';

// T-0463: the group background an owner/admin sets, shared by the detail and
// the chat list. Same shape and rules as the per-user background fields.
export interface GroupBackground {
  backgroundPreset: string | null;
  backgroundImageId: string | null;
  backgroundDim: number | null;
}

export interface GroupDetail {
  id: string;
  title: string;
  createdBy: string;
  createdAt: Date;
  membersCanCreateTopics: boolean;
  // T-0124: `group` behaves as before; `channel` is the broadcast feed (its
  // General topic is the feed; no more topics; posting is voice-gated by the
  // moderated room). Optional in older payloads = `group`.
  kind: ChannelKind;
  // T-0124: the channel's short blurb, or null when none.
  description: string | null;
  // T-0164: `private` groups stay invisible and invite-only, like before;
  // `public` ones hold exactly one `handles` row and appear in the
  // directory. Optional in older payloads = `private`.
  visibility: GroupVisibility;
  // T-0164: the group's `@handle` while public, null while private.
  // Optional in older payloads = null.
  handle: string | null;
  // T-0165: the group's picture, when it has one. Omitted when none.
  avatarUrl?: string | undefined;
  // T-0463: the background set for the whole group by an owner or admin.
  background: GroupBackground;
  // T-0474: the listener switch and eagerness stored on the group, plus
  // `available`, the server `LISTENER_ENABLED` flag that gates them. The
  // settings are inert while `available` is false.
  listener: {
    enabled: boolean;
    eagerness: GroupListenerEagerness;
    available: boolean;
  };
  members: GroupMemberView[];
  ais: GroupAiView[];
}

export interface GroupAiView {
  aiId: string;
  jid: string;
  name: string;
  ownerId: string;
  /** T-0165: the AI's picture, when it has one. Omitted when none. */
  avatarUrl?: string | undefined;
}

export interface ChatGroup {
  id: string;
  roomLocalpart: string;
  title: string;
  memberCount: number;
  role: GroupRole;
  kind: ChannelKind;
  description: string | null;
  // T-0164: the group's `visibility` (private stays invite-only; public is
  // in the directory) and its `@handle` while public (null while private).
  visibility: GroupVisibility;
  handle: string | null;
  // T-0463: the background set for the whole group by an owner or admin.
  background: GroupBackground;
}

export interface CreateGroupInput {
  creatorId: string;
  title: string;
  memberIds: string[];
  domain: string;
  logger: InviteLogger;
  // T-0124: `channel` creates the broadcast feed (moderated room, owner +
  // admins post). `group` (default) behaves as before. A description (≤ 300)
  // is accepted for both and stored on the row.
  kind?: ChannelKind | undefined;
  description?: string | undefined;
  // T-0164: `public` creates the group with a handle in one transaction
  // (same rules as the visibility change: shape, reserved words, 409
  // `handle_taken` on a race); `private` (default) behaves as before.
  visibility?: 'private' | 'public' | undefined;
  handle?: string | undefined;
  now?: Date;
}

export interface AddGroupMembersInput {
  groupId: string;
  actorId: string;
  userIds: string[];
  domain: string;
  logger: InviteLogger;
}

export interface RemoveGroupMemberInput {
  groupId: string;
  actorId: string;
  targetUserId: string;
  domain: string;
  logger: InviteLogger;
}

export interface AddGroupAiInput {
  groupId: string;
  actorId: string;
  aiId: string;
  domain: string;
  logger: InviteLogger;
}

export interface RemoveGroupAiInput {
  groupId: string;
  actorId: string;
  aiId: string;
  domain: string;
  logger: InviteLogger;
}

export interface ChangeMemberRoleInput {
  groupId: string;
  actorId: string;
  targetUserId: string;
  role: 'admin' | 'member';
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

export interface PatchGroupInput {
  groupId: string;
  actorId: string;
  membersCanCreateTopics?: boolean | undefined;
  // T-0463: a partial background patch. `undefined` keeps a stored value,
  // `null` clears it. Validated with the same rules as the per-user prefs.
  background?: BackgroundFieldsInput | undefined;
  // T-0474: the listener switch and eagerness (owner or admin).
  listenerEnabled?: boolean | undefined;
  listenerEagerness?: GroupListenerEagerness | undefined;
}

// The three nullable background columns with the same merge semantics as the
// per-user prefs (T-0458): `undefined` keeps, `null` clears.
interface BackgroundFieldsInput {
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

// Merges a group background patch with the stored values and rejects the
// invalid combinations with the same messages as T-0458. An image that does
// not exist and one owned by another user answer the same error, so an id
// cannot be probed.
export async function resolveGroupBackground(
  db: ServerDatabase,
  actorId: string,
  existing: GroupBackground,
  input: BackgroundFieldsInput,
): Promise<GroupBackground> {
  const backgroundPreset =
    input.backgroundPreset === undefined ? existing.backgroundPreset : input.backgroundPreset;
  const backgroundImageId =
    input.backgroundImageId === undefined ? existing.backgroundImageId : input.backgroundImageId;
  const backgroundDim =
    input.backgroundDim === undefined ? existing.backgroundDim : input.backgroundDim;

  if (backgroundPreset !== null && backgroundImageId !== null) {
    throw new HttpError(400, 'invalid_request', 'Choose a preset or an image');
  }
  if (backgroundDim !== null && backgroundImageId === null) {
    throw new HttpError(400, 'invalid_request', 'Dim needs an image');
  }
  if (backgroundImageId !== null) {
    const [image] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM chat_backgrounds
          WHERE id = ${backgroundImageId} AND user_id = ${actorId} LIMIT 1`;
      }),
    );
    if (image === undefined) {
      throw new HttpError(400, 'invalid_request', 'Unknown background image');
    }
  }
  return { backgroundPreset, backgroundImageId, backgroundDim };
}

export function mapXmppError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}
