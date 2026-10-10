// The middleware tags the contract's groups declare. Tags only: the server
// implements them as layers, and a client skips them (none is
// `requiredForClient`, none declares an error schema).
//
// A tag's identity is its key. `Session` and `CurrentUser` keep the keys of
// the tags in `apps/server/src/effect/http-core.ts`, so at runtime they are
// the same services; that file re-exports these two classes, so a server
// module uses them directly (no bridge).

import { Context } from 'effect';
import { HttpApiMiddleware } from 'effect/http-api';

/** The slice of the signed-in user an endpoint handler may read. */
export interface SessionUser {
  readonly id: string;
}

/** Provided by the session middleware; handlers read the current user id. */
export class CurrentUser extends Context.Service<CurrentUser, SessionUser>()(
  'zilar/effect/http/CurrentUser',
) {}

/**
 * Every endpoint of a group that declares it requires a signed-in user. An
 * absent session answers 401 before any query or body decoding runs.
 */
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentUser }>()(
  'zilar/effect/http/Session',
) {}

// ---------------------------------------------------------------------------
// Schema errors. `SchemaErrors` renders a params, query or payload decode
// failure as 400 `invalid_request` with the schema's text; the tags after it
// keep a fixed or typed answer for one group.
// ---------------------------------------------------------------------------

/** Renders a params, query or payload decode failure as 400 `invalid_request`. */
export class SchemaErrors extends HttpApiMiddleware.Service<SchemaErrors>()(
  'zilar/effect/http/SchemaErrors',
) {}

/** Any audit query decode failure is the fixed text `Invalid audit query`. */
export class AuditSchemaErrors extends HttpApiMiddleware.Service<AuditSchemaErrors>()(
  'zilar/effect/http/AuditSchemaErrors',
) {}

/** A decision payload decode failure is 400 `invalid_request`, "Invalid decision body". */
export class ApprovalsSchemaErrors extends HttpApiMiddleware.Service<ApprovalsSchemaErrors>()(
  'zilar/effect/http/ApprovalsSchemaErrors',
) {}

/** Renders an AI payload decode failure as 400 `invalid_request`. */
export class AisSchemaErrors extends HttpApiMiddleware.Service<AisSchemaErrors>()(
  'zilar/effect/http/AisSchemaErrors',
) {}

/**
 * A contact-request payload decode failure answers 400 `invalid_request` with
 * one fixed message (the shared schema-error tag would carry the schema text).
 */
export class ContactRequestsSchemaErrors extends HttpApiMiddleware.Service<ContactRequestsSchemaErrors>()(
  'zilar/effect/http/ContactRequestsSchemaErrors',
) {}

/**
 * A handles query or payload decode failure: an invalid check query is a 200
 * `{ available: false, reason: 'invalid' }` answer, an invalid claim body is a
 * 400 `invalid_request` error.
 */
export class HandlesSchemaErrors extends HttpApiMiddleware.Service<HandlesSchemaErrors>()(
  'zilar/effect/http/HandlesSchemaErrors',
) {}

/** Any search query decode failure is the fixed text `Invalid search query`. */
export class SearchSchemaErrors extends HttpApiMiddleware.Service<SearchSchemaErrors>()(
  'zilar/effect/http/SearchSchemaErrors',
) {}

/**
 * Renders a sticker payload decode failure as 400 `invalid_request` with the
 * fixed per-route message (picked by the request path).
 */
export class StickersSchemaErrors extends HttpApiMiddleware.Service<StickersSchemaErrors>()(
  'zilar/effect/http/StickersSchemaErrors',
) {}

// ---------------------------------------------------------------------------
// Guards and budgets. Each runs after `Session` and before the decode, so a
// malformed request still spends its budget.
// ---------------------------------------------------------------------------

/**
 * The pins write budget. It runs before the payload is decoded, so an invalid
 * body still spends budget.
 */
export class PinsWriteRateLimit extends HttpApiMiddleware.Service<
  PinsWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/PinsWriteRateLimit') {}

/**
 * The join preview budget. It runs before the token is checked, so a malformed
 * token still spends budget.
 */
export class InviteLinksPreviewRateLimit extends HttpApiMiddleware.Service<
  InviteLinksPreviewRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/InviteLinksPreviewRateLimit') {}

/**
 * The role-change budget (T-0124): role changes hit ejabberd, so they are
 * capped per owner. It runs before the payload is decoded, so an invalid body
 * still spends budget.
 */
export class GroupsRoleRateLimit extends HttpApiMiddleware.Service<
  GroupsRoleRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsRoleRateLimit') {}

/**
 * The open-join budget (T-0164). It runs before the path is decoded, so a bad
 * group id still spends budget.
 */
export class GroupsJoinRateLimit extends HttpApiMiddleware.Service<
  GroupsJoinRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsJoinRateLimit') {}

/**
 * The topic-creation budget (T-0108): creating a topic hits ejabberd, so it is
 * capped per user. It runs before the payload is decoded, so an invalid body
 * still spends budget.
 */
export class TopicsCreateRateLimit extends HttpApiMiddleware.Service<
  TopicsCreateRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/TopicsCreateRateLimit') {}

/**
 * The AI-memory write budget. It runs before the query or payload is decoded,
 * so an invalid request still spends budget.
 */
export class AiMemoryWriteRateLimit extends HttpApiMiddleware.Service<
  AiMemoryWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/AiMemoryWriteRateLimit') {}

/**
 * The 503 availability gate of the AI routes that need LiteLLM and the key
 * cipher. It runs before the payload is decoded: a malformed body on an
 * unconfigured server still answers 503, not 400.
 */
export class AisConfigured extends HttpApiMiddleware.Service<
  AisConfigured,
  { requires: CurrentUser }
>()('zilar/effect/http/AisConfigured') {}

/** The blocks write budget; it runs before the service, after `Session`. */
export class BlocksWriteRateLimit extends HttpApiMiddleware.Service<
  BlocksWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksWriteRateLimit') {}

/** The blocks list budget. */
export class BlocksReadRateLimit extends HttpApiMiddleware.Service<
  BlocksReadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksReadRateLimit') {}

/** The create budget; it runs before the payload is decoded, so a bad body still spends it. */
export class ContactRequestCreateRateLimit extends HttpApiMiddleware.Service<
  ContactRequestCreateRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactRequestCreateRateLimit') {}

/** The read budget: list, accept, decline and cancel. */
export class ContactRequestReadRateLimit extends HttpApiMiddleware.Service<
  ContactRequestReadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactRequestReadRateLimit') {}

/** The budget of the by-handle lookup. */
export class ContactRequestByHandleRateLimit extends HttpApiMiddleware.Service<
  ContactRequestByHandleRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/ContactRequestByHandleRateLimit') {}

/** The handle-check budget; it runs before the query is decoded. */
export class HandlesCheckRateLimit extends HttpApiMiddleware.Service<
  HandlesCheckRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/HandlesCheckRateLimit') {}

/** The directory read budget; it runs before the query is decoded. */
export class DirectoryRateLimit extends HttpApiMiddleware.Service<
  DirectoryRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/DirectoryRateLimit') {}

/**
 * The archive (501) and rate-limit (429) guards of search. They run after
 * `Session` and before the query is decoded.
 */
export class SearchGuards extends HttpApiMiddleware.Service<
  SearchGuards,
  { requires: CurrentUser }
>()('zilar/effect/http/SearchGuards') {}

/** The Telegram token save budget; runs after the owner check, before the decode. */
export class IntegrationsTelegramRateLimit extends HttpApiMiddleware.Service<
  IntegrationsTelegramRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/IntegrationsTelegramRateLimit') {}

/** The email save guard: owner, env guard, then budget, before the decode. */
export class IntegrationsEmailRateLimit extends HttpApiMiddleware.Service<
  IntegrationsEmailRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/IntegrationsEmailRateLimit') {}

/** The sticker upload budget; the first step after the session. */
export class StickersUploadRateLimit extends HttpApiMiddleware.Service<
  StickersUploadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/StickersUploadRateLimit') {}

/** The background upload budget; runs before the body is read. */
export class BackgroundsUploadRateLimit extends HttpApiMiddleware.Service<
  BackgroundsUploadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BackgroundsUploadRateLimit') {}

/** The pairing-code budget; spent right after the session, before any query. */
export class MachinesPairingCodeRateLimit extends HttpApiMiddleware.Service<
  MachinesPairingCodeRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/MachinesPairingCodeRateLimit') {}
