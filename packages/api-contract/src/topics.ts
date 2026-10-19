// A topic the viewer may not see is a 404 everywhere, byte-identical to a missing id.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { lenientLiterals } from './lenient';
import {
  SchemaErrors,
  Session,
  TopicsCreateRateLimit,
  TopicsJoinRateLimit,
  TopicsPreviewRateLimit,
} from './middleware';
import { mutableStruct } from './mutable-struct';
import { hasControlCharacters } from './roles';

export const TOPIC_NAME_MAX = 80;
export const TOPIC_LINK_URL_MAX = 300;
export const TOPIC_LINK_LABEL_MAX = 40;
export const TOPIC_MEMBERS_MAX = 50;
export const TOPIC_ROLES_MAX = 20;

export const TOPIC_VISIBILITIES = ['public', 'private'] as const;
export const TOPIC_KINDS = ['chat', 'task', 'bug', 'ui', 'routine'] as const;
export const TOPIC_STATUSES = ['open', 'in_progress', 'in_review', 'blocked', 'done'] as const;

const TopicVisibilitySchema = Schema.Literals(TOPIC_VISIBILITIES);
const TopicKindSchema = Schema.Literals(TOPIC_KINDS);
const TopicStatusSchema = Schema.Literals(TOPIC_STATUSES);

export type TopicVisibility = (typeof TOPIC_VISIBILITIES)[number];
export type TopicKind = (typeof TOPIC_KINDS)[number];
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

const TopicName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TOPIC_NAME_MAX),
  Schema.makeFilter((value) =>
    hasControlCharacters(value) ? 'name must not contain control characters' : undefined,
  ),
);

const TopicGlyph = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8),
  Schema.makeFilter((value) => {
    const length = [...value].length;
    return length >= 1 && length <= 2 ? undefined : 'glyph must be 1 or 2 characters';
  }),
  Schema.makeFilter((value) =>
    hasControlCharacters(value) ? 'glyph must not contain control characters' : undefined,
  ),
);

const TopicLinkUrl = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TOPIC_LINK_URL_MAX),
  Schema.makeFilter((value) =>
    value.startsWith('https://') ? undefined : 'linkUrl must be an https URL',
  ),
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return undefined;
    } catch {
      return 'linkUrl must be a valid URL';
    }
  }),
);

const TopicLinkLabel = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(TOPIC_LINK_LABEL_MAX),
);

const TopicOwnerRef = Schema.Struct({
  kind: Schema.Literals(['user', 'ai']),
  id: Schema.String.check(Schema.isMinLength(1)),
});

const MemberIds = Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
  Schema.isMaxLength(TOPIC_MEMBERS_MAX),
);

export const CreateTopicPayload = Schema.Struct({
  name: TopicName,
  kind: Schema.optional(TopicKindSchema),
  visibility: Schema.optional(TopicVisibilitySchema),
  memberIds: Schema.optional(MemberIds),
  glyph: Schema.optional(TopicGlyph),
  owner: Schema.optional(Schema.NullOr(TopicOwnerRef)),
  linkUrl: Schema.optional(Schema.NullOr(TopicLinkUrl)),
  linkLabel: Schema.optional(Schema.NullOr(TopicLinkLabel)),
});

export const PatchTopicPayload = Schema.Struct({
  name: Schema.optional(TopicName),
  glyph: Schema.optional(TopicGlyph),
  kind: Schema.optional(TopicKindSchema),
  status: Schema.optional(TopicStatusSchema),
  owner: Schema.optional(Schema.NullOr(TopicOwnerRef)),
  linkUrl: Schema.optional(Schema.NullOr(TopicLinkUrl)),
  linkLabel: Schema.optional(Schema.NullOr(TopicLinkLabel)),
  archived: Schema.optional(Schema.Literal(true)),
  visibility: Schema.optional(TopicVisibilitySchema),
  memberIds: Schema.optional(MemberIds),
  confirmExposeHistory: Schema.optional(Schema.Boolean),
  done: Schema.optional(Schema.Boolean),
});

export const AddTopicMemberPayload = Schema.Struct({
  userId: Schema.String.check(Schema.isMinLength(1)),
});

export const AddTopicAiPayload = Schema.Struct({
  aiId: Schema.String.check(Schema.isMinLength(1)),
});

export const SetTopicRolesPayload = Schema.Struct({
  roleIds: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
    Schema.isMaxLength(TOPIC_ROLES_MAX),
  ),
  approverRoleId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
});

// The server trims `name`, `linkUrl` and `linkLabel`; the contract encodes the trimmed form, so a client trims before it calls.
export function trimTopicText<
  T extends { name?: string; linkUrl?: string | null; linkLabel?: string | null },
>(input: T): T {
  return {
    ...input,
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(typeof input.linkUrl === 'string' ? { linkUrl: input.linkUrl.trim() } : {}),
    ...(typeof input.linkLabel === 'string' ? { linkLabel: input.linkLabel.trim() } : {}),
  };
}

export const TopicOwner = mutableStruct({
  kind: Schema.Literals(['user', 'ai']),
  id: Schema.String,
  name: Schema.String,
});

export type TopicOwner = typeof TopicOwner.Type;

export const TopicAi = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  jid: Schema.optional(Schema.String),
});

export type TopicAi = typeof TopicAi.Type;

export const TopicRole = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  memberCount: Schema.Number,
});

export type TopicRole = typeof TopicRole.Type;

export const ApproverRole = mutableStruct({ id: Schema.String, name: Schema.String });

export type ApproverRole = typeof ApproverRole.Type;

export const TopicActivity = mutableStruct({
  aiId: Schema.String,
  name: Schema.String,
  jid: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  questionId: Schema.optional(Schema.String),
  state: Schema.String,
});

export type TopicActivity = typeof TopicActivity.Type;

// An unknown `visibility` from a newer server reads as `private` (hiding is safer than leaking).
export const Topic = mutableStruct({
  id: Schema.String,
  groupId: Schema.String,
  name: Schema.String,
  glyph: Schema.String,
  chatJid: Schema.String,
  visibility: lenientLiterals(TOPIC_VISIBILITIES, 'private'),
  kind: Schema.optional(lenientLiterals(TOPIC_KINDS, 'chat')),
  status: Schema.optional(lenientLiterals(TOPIC_STATUSES, 'open')),
  owner: Schema.optional(Schema.NullOr(TopicOwner)),
  linkUrl: Schema.NullOr(Schema.String),
  linkLabel: Schema.NullOr(Schema.String),
  isGeneral: Schema.Boolean,
  archived: Schema.Boolean,
  doneAt: Schema.optional(Schema.NullOr(Schema.String)),
  memberCount: Schema.Number,
  memberIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  ais: Schema.mutable(Schema.Array(TopicAi)),
  roles: Schema.optional(Schema.mutable(Schema.Array(TopicRole))),
  approverRole: Schema.optional(Schema.NullOr(ApproverRole)),
  activity: Schema.optional(Schema.mutable(Schema.Array(TopicActivity))),
});

export type Topic = typeof Topic.Type;

export const TopicList = Schema.Struct({ topics: Schema.mutable(Schema.Array(Topic)) });

export const TopicMember = mutableStruct({ userId: Schema.String, name: Schema.String });

export type TopicMember = typeof TopicMember.Type;

export const TopicMemberList = Schema.Struct({
  members: Schema.mutable(Schema.Array(TopicMember)),
});

export const TopicAiList = Schema.Struct({ ais: Schema.mutable(Schema.Array(TopicAi)) });

export const TopicPreviewMessage = mutableStruct({
  id: Schema.String,
  at: Schema.String,
  nick: Schema.String,
  body: Schema.String,
  payload: Schema.optional(Schema.Unknown),
});

export type TopicPreviewMessage = typeof TopicPreviewMessage.Type;

export const TopicPreview = Schema.Struct({
  messages: Schema.mutable(Schema.Array(TopicPreviewMessage)),
});

export type TopicPreview = typeof TopicPreview.Type;

const GroupIdParams = Schema.Struct({ id: Schema.String });
const TopicIdParams = Schema.Struct({ id: Schema.String });
const TopicMemberParams = Schema.Struct({ id: Schema.String, userId: Schema.String });
const TopicAiParams = Schema.Struct({ id: Schema.String, aiId: Schema.String });

export const TopicsGroup = HttpApiGroup.make('topics')
  .add(
    HttpApiEndpoint.get('list', '/groups/:id/topics', {
      params: GroupIdParams,
      success: TopicList,
    }),
    HttpApiEndpoint.post('create', '/groups/:id/topics', {
      params: GroupIdParams,
      payload: CreateTopicPayload,
      success: Topic.pipe(HttpApiSchema.status(201)),
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(TopicsCreateRateLimit),
    HttpApiEndpoint.get('detail', '/topics/:id', {
      params: TopicIdParams,
      success: Topic,
    }),
    HttpApiEndpoint.patch('patch', '/topics/:id', {
      params: TopicIdParams,
      payload: PatchTopicPayload,
      success: Topic,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.post('archive', '/topics/:id/archive', {
      params: TopicIdParams,
      success: Topic,
    }),
    HttpApiEndpoint.get('members', '/topics/:id/members', {
      params: TopicIdParams,
      success: TopicMemberList,
    }),
    HttpApiEndpoint.post('addMember', '/topics/:id/members', {
      params: TopicIdParams,
      payload: AddTopicMemberPayload,
      success: Topic,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('removeMember', '/topics/:id/members/:userId', {
      params: TopicMemberParams,
      success: Topic,
    }),
    HttpApiEndpoint.post('join', '/topics/:id/join', {
      params: TopicIdParams,
      success: Topic,
    }).middleware(TopicsJoinRateLimit),
    HttpApiEndpoint.get('preview', '/topics/:id/preview', {
      params: TopicIdParams,
      success: TopicPreview,
    }).middleware(TopicsPreviewRateLimit),
    HttpApiEndpoint.put('setRoles', '/topics/:id/roles', {
      params: TopicIdParams,
      payload: SetTopicRolesPayload,
      success: Topic,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('listAis', '/topics/:id/ais', {
      params: TopicIdParams,
      success: TopicAiList,
    }),
    HttpApiEndpoint.post('addAi', '/topics/:id/ais', {
      params: TopicIdParams,
      payload: AddTopicAiPayload,
      success: Topic,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('removeAi', '/topics/:id/ais/:aiId', {
      params: TopicAiParams,
      success: Topic,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
