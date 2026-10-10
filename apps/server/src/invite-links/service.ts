// The invite-links service barrel (T-0991 size split): the old
// `invite-links/service.ts` contents live in `tokens.ts` (types, constants
// and token primitives), `queries.ts` (the link reads and writes) and
// `join.ts` (the preview and join flow). This path re-exports every name it
// exported before, so importers do not change.

export {
  INVITE_LINK_CREATE_MAX_EXPIRY_HOURS,
  INVITE_LINK_CREATE_MAX_USES,
  INVITE_LINK_LABEL_MAX,
  INVITE_LINK_MIN_EXPIRY_HOURS,
  INVITE_LINK_MIN_MAX_USES,
  INVITE_LINK_TOKEN_BYTES,
  JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER,
  JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS,
  JOIN_RATE_LIMIT_MAX_PER_IP,
  JOIN_RATE_LIMIT_MAX_PER_USER,
  JOIN_RATE_LIMIT_WINDOW_MS,
  MAX_ACTIVE_INVITE_LINKS,
  INVALID_LINK,
  generateInviteToken,
  hashInviteToken,
  inviteTokenMatches,
  joinUrlFor,
  toInviteLinkView,
  toInvalidLink,
  tokenHintFor,
} from './tokens';
export type {
  CreateInviteLinkInput,
  CreatedInviteLink,
  GroupInviteLinkRow,
  InviteLinkServiceDeps,
  InviteLinkView,
  JoinPreview,
} from './tokens';
export { createInviteLink, linkIsUsable, listInviteLinks, revokeInviteLink } from './queries';
export {
  assertGroupHasRoom,
  joinByInviteLink,
  previewInviteLink,
  syncPublicTopicsByLink,
} from './join';
export type { JoinByLinkResult } from './join';
