// Group invite links (T-0115): shareable links that join a group as `member`.
// The token is shown once at creation and never stored, so the list carries
// hints, labels, uses and state, never tokens. Joining by link has a preview
// (group title and member count only) and a join.
//
// The `:token` param stays a plain string: the server checks its shape inside
// the handler and answers the same 404 `invalid_link` for every bad link, so
// declaring a pattern here would change the answer and the order of checks.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { ChainASchemaErrors, InviteLinksPreviewRateLimit } from './chain-a-middleware';
import { lenientLiterals } from './lenient';
import { Session } from './middleware';

export const INVITE_LINK_LABEL_MAX = 60;
export const INVITE_LINK_CREATE_MAX_USES = 10000;
export const INVITE_LINK_CREATE_MAX_EXPIRY_HOURS = 8760;
export const INVITE_LINK_MIN_EXPIRY_HOURS = 1;
export const INVITE_LINK_MIN_MAX_USES = 1;

/** Trimmed before the length checks. */
const InviteLinkLabel = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(INVITE_LINK_LABEL_MAX),
);

const ExpiresInHours = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(INVITE_LINK_MIN_EXPIRY_HOURS),
  Schema.isLessThanOrEqualTo(INVITE_LINK_CREATE_MAX_EXPIRY_HOURS),
);

const MaxUses = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(INVITE_LINK_MIN_MAX_USES),
  Schema.isLessThanOrEqualTo(INVITE_LINK_CREATE_MAX_USES),
);

export const CreateInviteLinkPayload = Schema.Struct({
  label: Schema.optional(InviteLinkLabel),
  expiresInHours: Schema.optional(ExpiresInHours),
  maxUses: Schema.optional(MaxUses),
});

export type CreateInviteLinkPayload = typeof CreateInviteLinkPayload.Type;

export const CreatedInviteLink = Schema.Struct({
  id: Schema.String,
  // The raw token, shown once at creation and never stored or listed.
  token: Schema.String,
  url: Schema.String,
});

export type CreatedInviteLink = typeof CreatedInviteLink.Type;

export const InviteLink = Schema.Struct({
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  tokenHint: Schema.String,
  uses: Schema.Number,
  maxUses: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.String),
  revoked: Schema.Boolean,
  createdAt: Schema.String,
});

export type InviteLink = typeof InviteLink.Type;

export const InviteLinkList = Schema.Struct({ links: Schema.mutable(Schema.Array(InviteLink)) });

const JOIN_KINDS = ['group', 'channel'] as const;

/**
 * `groupId` is present only for an already-member, so previews leak no group
 * ids. `kind` is absent on older servers (a group) and an unknown value from a
 * newer server reads as a group.
 */
export const JoinPreview = Schema.Struct({
  groupTitle: Schema.String,
  memberCount: Schema.Number,
  alreadyMember: Schema.Boolean,
  groupId: Schema.optional(Schema.String),
  kind: Schema.optional(lenientLiterals(JOIN_KINDS, 'group')),
});

export type JoinPreview = typeof JoinPreview.Type;

export const JoinResult = Schema.Struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

export type JoinResult = typeof JoinResult.Type;

const GroupIdParams = Schema.Struct({ id: Schema.String });
const InviteLinkParams = Schema.Struct({ id: Schema.String, linkId: Schema.String });
const JoinTokenParams = Schema.Struct({ token: Schema.String });

export const InviteLinksGroup = HttpApiGroup.make('invite-links')
  .add(
    HttpApiEndpoint.post('createLink', '/groups/:id/invite-links', {
      params: GroupIdParams,
      payload: CreateInviteLinkPayload,
      success: CreatedInviteLink.pipe(HttpApiSchema.status(201)),
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('listLinks', '/groups/:id/invite-links', {
      params: GroupIdParams,
      success: InviteLinkList,
    }),
    HttpApiEndpoint.delete('revokeLink', '/groups/:id/invite-links/:linkId', {
      params: InviteLinkParams,
      success: HttpApiSchema.NoContent,
    }),
    // The preview limiter runs before the token is checked, like the old
    // route's `previewLimiter.allow` -> token check order.
    HttpApiEndpoint.get('preview', '/join/:token', {
      params: JoinTokenParams,
      success: JoinPreview,
    }).middleware(InviteLinksPreviewRateLimit),
    HttpApiEndpoint.post('join', '/join/:token', {
      params: JoinTokenParams,
      success: JoinResult,
    }),
  )
  .middleware(Session)
  .middleware(ChainASchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
