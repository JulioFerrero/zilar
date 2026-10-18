import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { GROUP_MEMBERS_MAX } from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import type { GroupVisibility } from './visibility';

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
  /** The custom group roles this member holds. */
  roles: Array<{ id: string; name: string }>;
  handle?: string | null | undefined;
  avatarUrl?: string | undefined;
}

export type ChannelKind = 'group' | 'channel';

export type GroupListenerEagerness = 'quiet' | 'normal' | 'eager';

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
  kind: ChannelKind;
  description: string | null;
  visibility: GroupVisibility;
  handle: string | null;
  avatarUrl?: string | undefined;
  background: GroupBackground;
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
  avatarUrl?: string | undefined;
}

export interface ChatGroup {
  id: string;
  roomLocalpart: string;
  title: string;
  createdAt: Date;
  memberCount: number;
  role: GroupRole;
  kind: ChannelKind;
  description: string | null;
  visibility: GroupVisibility;
  handle: string | null;
  background: GroupBackground;
}

export interface CreateGroupInput {
  creatorId: string;
  title: string;
  memberIds: string[];
  domain: string;
  logger: InviteLogger;
  kind?: ChannelKind | undefined;
  description?: string | undefined;
  // `public` creates the group with a handle in one transaction; the
  // uniqueness race maps to 409 `handle_taken`.
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
  background?: BackgroundFieldsInput | undefined;
  listenerEnabled?: boolean | undefined;
  listenerEagerness?: GroupListenerEagerness | undefined;
}

interface BackgroundFieldsInput {
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

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
  return xmppUnavailable();
}
