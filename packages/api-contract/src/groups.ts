// Groups and channels (T-0124, T-0164): create, read, change members, role,
// AIs and settings, and the open join of public groups. A channel is a group
// with one feed. The detail fields an older server omitted stay optional, so
// an older payload still parses.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { CHAT_BACKGROUND_PRESET_IDS } from './chat-prefs';
import { GroupsJoinRateLimit, GroupsRoleRateLimit, SchemaErrors, Session } from './middleware';
import { mutableStruct } from './mutable-struct';

export const GROUP_MEMBERS_MAX = 50;

const GroupMemberRole = Schema.Literals(['owner', 'admin', 'member']);
const ChangeableRole = Schema.Literals(['admin', 'member']);
const ChannelKind = Schema.Literals(['group', 'channel']);
const GroupVisibility = Schema.Literals(['private', 'public']);
const LISTENER_EAGERNESS = ['quiet', 'normal', 'eager'] as const;
const ListenerEagernessSchema = Schema.Literals(LISTENER_EAGERNESS);
const BackgroundPresetSchema = Schema.Literals(CHAT_BACKGROUND_PRESET_IDS);

export type ListenerEagerness = (typeof LISTENER_EAGERNESS)[number];

// Trimmed before the length checks, like zod's `.trim().min().max()`.
const Title = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const Description = Schema.Trim.check(Schema.isMaxLength(300));
const Handle = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

const MemberIds = Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
  Schema.isMaxLength(GROUP_MEMBERS_MAX),
);

/** An omitted `memberIds` is an empty list; `kind`, `description`, `visibility` and `handle` are optional. */
export const CreateGroupPayload = Schema.Struct({
  title: Title,
  memberIds: Schema.optional(MemberIds),
  kind: Schema.optional(ChannelKind),
  description: Schema.optional(Description),
  visibility: Schema.optional(GroupVisibility),
  handle: Schema.optional(Handle),
});

/** 1..50 non-empty user ids. */
export const AddGroupMembersPayload = Schema.Struct({
  userIds: MemberIds.check(Schema.isMinLength(1)),
});

export const AddGroupAiPayload = Schema.Struct({
  aiId: Schema.String.check(Schema.isMinLength(1)),
});

export const ChangeGroupRolePayload = Schema.Struct({ role: ChangeableRole });

/** Strict at the top level and on `background`: `undefined` keeps a field, `null` clears it. */
export const GroupBackgroundPatch = Schema.Struct({
  backgroundPreset: Schema.optional(Schema.NullOr(BackgroundPresetSchema)),
  backgroundImageId: Schema.optional(Schema.NullOr(Handle)),
  backgroundDim: Schema.optional(
    Schema.NullOr(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(80),
      ),
    ),
  ),
});

export const PatchGroupPayload = Schema.Struct({
  membersCanCreateTopics: Schema.optional(Schema.Boolean),
  visibility: Schema.optional(GroupVisibility),
  handle: Schema.optional(Handle),
  background: Schema.optional(GroupBackgroundPatch),
  listenerEnabled: Schema.optional(Schema.Boolean),
  listenerEagerness: Schema.optional(ListenerEagernessSchema),
});

export type PatchGroupPayload = typeof PatchGroupPayload.Type;

export const GroupMember = mutableStruct({
  userId: Schema.String,
  name: Schema.String,
  role: GroupMemberRole,
  // The custom roles this member holds (T-0116); absent on older servers.
  roles: Schema.optional(
    Schema.mutable(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  ),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
});

export type GroupMember = typeof GroupMember.Type;

export const GroupAi = mutableStruct({
  aiId: Schema.String,
  jid: Schema.String,
  name: Schema.String,
  ownerId: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
});

export type GroupAi = typeof GroupAi.Type;

/** The group's shared background, set by owners and admins. */
export const GroupBackground = Schema.Struct({
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
});

export type GroupBackground = typeof GroupBackground.Type;

/** `available` is the server's `LISTENER_ENABLED` flag: when false the controls stay disabled. */
export const GroupListener = Schema.Struct({
  enabled: Schema.Boolean,
  eagerness: ListenerEagernessSchema,
  available: Schema.Boolean,
});

export const GroupDetail = mutableStruct({
  id: Schema.String,
  title: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.optional(Schema.Date),
  membersCanCreateTopics: Schema.optional(Schema.Boolean),
  kind: Schema.optional(ChannelKind),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  visibility: Schema.optional(GroupVisibility),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
  background: Schema.optional(GroupBackground),
  listener: Schema.optional(GroupListener),
  members: Schema.mutable(Schema.Array(GroupMember)),
  ais: Schema.mutable(Schema.Array(GroupAi)),
});

export type GroupDetail = typeof GroupDetail.Type;

export const GroupMemberList = Schema.Struct({
  members: Schema.mutable(Schema.Array(GroupMember)),
});

export const GroupJoinResult = Schema.Struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

export type GroupJoinResult = typeof GroupJoinResult.Type;

const GroupIdParams = Schema.Struct({ id: Schema.String });
const GroupMemberParams = Schema.Struct({ id: Schema.String, userId: Schema.String });
const GroupAiParams = Schema.Struct({ id: Schema.String, aiId: Schema.String });

export const GroupsGroup = HttpApiGroup.make('groups')
  .add(
    HttpApiEndpoint.post('create', '/groups', {
      payload: CreateGroupPayload,
      success: GroupDetail.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.get('detail', '/groups/:id', {
      params: GroupIdParams,
      success: GroupDetail,
    }),
    HttpApiEndpoint.get('members', '/groups/:id/members', {
      params: GroupIdParams,
      success: GroupMemberList,
    }),
    HttpApiEndpoint.put('changeRole', '/groups/:id/members/:userId/role', {
      params: GroupMemberParams,
      payload: ChangeGroupRolePayload,
      success: GroupDetail,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(GroupsRoleRateLimit),
    HttpApiEndpoint.post('addMembers', '/groups/:id/members', {
      params: GroupIdParams,
      payload: AddGroupMembersPayload,
      success: GroupDetail,
    }),
    HttpApiEndpoint.delete('removeMember', '/groups/:id/members/:userId', {
      params: GroupMemberParams,
      success: GroupDetail,
    }),
    HttpApiEndpoint.post('addAi', '/groups/:id/ais', {
      params: GroupIdParams,
      payload: AddGroupAiPayload,
      success: GroupDetail,
    }),
    HttpApiEndpoint.delete('removeAi', '/groups/:id/ais/:aiId', {
      params: GroupAiParams,
      success: GroupDetail,
    }),
    HttpApiEndpoint.patch('patch', '/groups/:id', {
      params: GroupIdParams,
      payload: PatchGroupPayload,
      success: GroupDetail,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.post('join', '/groups/:id/join', {
      params: GroupIdParams,
      success: GroupJoinResult,
    }).middleware(GroupsJoinRateLimit),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
