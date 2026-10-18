// Tags only: the server implements them as layers and a client skips them.
// A tag's identity is its key; `Session` and `CurrentUser` keep the keys of `apps/server/src/effect/http-core.ts`, which re-exports these classes.

import { Context } from 'effect';
import { HttpApiMiddleware } from 'effect/http-api';

export interface SessionUser {
  readonly id: string;
}

export class CurrentUser extends Context.Service<CurrentUser, SessionUser>()(
  'zilar/effect/http/CurrentUser',
) {}

// An absent session answers 401 before any query or body decoding runs.
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentUser }>()(
  'zilar/effect/http/Session',
) {}

export class SchemaErrors extends HttpApiMiddleware.Service<SchemaErrors>()(
  'zilar/effect/http/SchemaErrors',
) {}

export class AuditSchemaErrors extends HttpApiMiddleware.Service<AuditSchemaErrors>()(
  'zilar/effect/http/AuditSchemaErrors',
) {}

export class ApprovalsSchemaErrors extends HttpApiMiddleware.Service<ApprovalsSchemaErrors>()(
  'zilar/effect/http/ApprovalsSchemaErrors',
) {}

export class AisSchemaErrors extends HttpApiMiddleware.Service<AisSchemaErrors>()(
  'zilar/effect/http/AisSchemaErrors',
) {}

export class ContactRequestsSchemaErrors extends HttpApiMiddleware.Service<ContactRequestsSchemaErrors>()(
  'zilar/effect/http/ContactRequestsSchemaErrors',
) {}

// An invalid check query is a 200 `{ available: false, reason: 'invalid' }`; an invalid claim body is a 400 `invalid_request`.
export class HandlesSchemaErrors extends HttpApiMiddleware.Service<HandlesSchemaErrors>()(
  'zilar/effect/http/HandlesSchemaErrors',
) {}

export class SearchSchemaErrors extends HttpApiMiddleware.Service<SearchSchemaErrors>()(
  'zilar/effect/http/SearchSchemaErrors',
) {}

export class StickersSchemaErrors extends HttpApiMiddleware.Service<StickersSchemaErrors>()(
  'zilar/effect/http/StickersSchemaErrors',
) {}

// The pins write budget runs before the payload is decoded, so an invalid body still spends budget.
export class PinsWriteRateLimit extends HttpApiMiddleware.Service<
  PinsWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/PinsWriteRateLimit') {}

// The join preview budget runs before the token is checked, so a malformed token still spends budget.
export class InviteLinksPreviewRateLimit extends HttpApiMiddleware.Service<
  InviteLinksPreviewRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/InviteLinksPreviewRateLimit') {}

export class GroupsRoleRateLimit extends HttpApiMiddleware.Service<
  GroupsRoleRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsRoleRateLimit') {}

export class GroupsJoinRateLimit extends HttpApiMiddleware.Service<
  GroupsJoinRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsJoinRateLimit') {}

// A personal invite mints a one-use sign-up code, so it is capped per user.
export class AuthInviteRateLimit extends HttpApiMiddleware.Service<
  AuthInviteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/AuthInviteRateLimit') {}

// A name change refreshes the nickname in every contact's roster through ejabberd, so it is capped per user.
export class AuthMeRateLimit extends HttpApiMiddleware.Service<
  AuthMeRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/AuthMeRateLimit') {}

// Creating a group or channel creates a MUC room, so it is capped per user.
export class GroupsCreateRateLimit extends HttpApiMiddleware.Service<
  GroupsCreateRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsCreateRateLimit') {}

// Creating a topic hits ejabberd, so it is capped per user.
export class TopicsCreateRateLimit extends HttpApiMiddleware.Service<
  TopicsCreateRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/TopicsCreateRateLimit') {}

// Joining a topic hits ejabberd through the room sync, so it is capped per user.
export class TopicsJoinRateLimit extends HttpApiMiddleware.Service<
  TopicsJoinRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/TopicsJoinRateLimit') {}

// Reading a topic's archive for a non-member is capped per user.
export class TopicsPreviewRateLimit extends HttpApiMiddleware.Service<
  TopicsPreviewRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/TopicsPreviewRateLimit') {}

export class AiMemoryWriteRateLimit extends HttpApiMiddleware.Service<
  AiMemoryWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/AiMemoryWriteRateLimit') {}

// The 503 gate runs before the payload is decoded: a malformed body on an unconfigured server still answers 503, not 400.
export class AisConfigured extends HttpApiMiddleware.Service<
  AisConfigured,
  { requires: CurrentUser }
>()('zilar/effect/http/AisConfigured') {}

export class BlocksWriteRateLimit extends HttpApiMiddleware.Service<
  BlocksWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksWriteRateLimit') {}

export class BlocksReadRateLimit extends HttpApiMiddleware.Service<
  BlocksReadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksReadRateLimit') {}

// Every tap stores a response and corrects the card in the room, so it is capped per user.
export class BlocksRespondRateLimit extends HttpApiMiddleware.Service<
  BlocksRespondRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksRespondRateLimit') {}

export class ContactRequestCreateRateLimit extends HttpApiMiddleware.Service<
  ContactRequestCreateRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactRequestCreateRateLimit') {}

export class ContactRequestReadRateLimit extends HttpApiMiddleware.Service<
  ContactRequestReadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactRequestReadRateLimit') {}

export class ContactRequestByHandleRateLimit extends HttpApiMiddleware.Service<
  ContactRequestByHandleRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactRequestByHandleRateLimit') {}

export class UserSearchRateLimit extends HttpApiMiddleware.Service<
  UserSearchRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/UserSearchRateLimit') {}

// The handle-check budget runs before the query is decoded.
export class HandlesCheckRateLimit extends HttpApiMiddleware.Service<
  HandlesCheckRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/HandlesCheckRateLimit') {}

export class DirectoryRateLimit extends HttpApiMiddleware.Service<
  DirectoryRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/DirectoryRateLimit') {}

// The archive (501) and rate-limit (429) guards of search run after `Session` and before the query is decoded.
export class SearchGuards extends HttpApiMiddleware.Service<
  SearchGuards,
  { requires: CurrentUser }
>()('zilar/effect/http/SearchGuards') {}

export class IntegrationsTelegramRateLimit extends HttpApiMiddleware.Service<
  IntegrationsTelegramRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/IntegrationsTelegramRateLimit') {}

export class IntegrationsEmailRateLimit extends HttpApiMiddleware.Service<
  IntegrationsEmailRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/IntegrationsEmailRateLimit') {}

export class StickersUploadRateLimit extends HttpApiMiddleware.Service<
  StickersUploadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/StickersUploadRateLimit') {}

export class BackgroundsUploadRateLimit extends HttpApiMiddleware.Service<
  BackgroundsUploadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BackgroundsUploadRateLimit') {}

export class MachinesPairingCodeRateLimit extends HttpApiMiddleware.Service<
  MachinesPairingCodeRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/MachinesPairingCodeRateLimit') {}

// Every page load, tab and reconnect mints a token, so the route is capped per user.
export class XmppTokenRateLimit extends HttpApiMiddleware.Service<
  XmppTokenRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/XmppTokenRateLimit') {}

// The transcript route answers 501 when the owner never configured an endpoint, before the payload is decoded.
export class TranscriptConfigured extends HttpApiMiddleware.Service<
  TranscriptConfigured,
  { requires: CurrentUser }
>()('zilar/effect/http/TranscriptConfigured') {}

// The owner settings answer 404 for non-owners and 429 over budget before the payload is decoded.
export class VoiceSettingsOwnerLimit extends HttpApiMiddleware.Service<
  VoiceSettingsOwnerLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/VoiceSettingsOwnerLimit') {}
