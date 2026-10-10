// The middleware tags of chain C's groups (T-0894): blocks, contact-requests,
// handles, directory, search, chats, drafts. They live apart from
// `middleware.ts` so parallel chains never edit the same lines. The plain
// schema-error tag is chain A's `ChainASchemaErrors`. A tag's
// identity is its key; none is `requiredForClient` and none declares an error
// schema, so a derived client skips them.

import { HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser } from './middleware';

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

/**
 * A contact-request payload decode failure answers 400 `invalid_request` with
 * one fixed message (the shared schema-error tag would carry the schema text).
 */
export class ContactRequestsSchemaErrors extends HttpApiMiddleware.Service<ContactRequestsSchemaErrors>()(
  'zilar/effect/http/ContactRequestsSchemaErrors',
) {}

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

/**
 * A handles query or payload decode failure: an invalid check query is a 200
 * `{ available: false, reason: 'invalid' }` answer, an invalid claim body is a
 * 400 `invalid_request` error.
 */
export class HandlesSchemaErrors extends HttpApiMiddleware.Service<HandlesSchemaErrors>()(
  'zilar/effect/http/HandlesSchemaErrors',
) {}

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

/** Any search query decode failure is the fixed text `Invalid search query`. */
export class SearchSchemaErrors extends HttpApiMiddleware.Service<SearchSchemaErrors>()(
  'zilar/effect/http/SearchSchemaErrors',
) {}

/**
 * The archive (501) and rate-limit (429) guards of search. They run after
 * `Session` and before the query is decoded.
 */
export class SearchGuards extends HttpApiMiddleware.Service<
  SearchGuards,
  { requires: CurrentUser }
>()('zilar/effect/http/SearchGuards') {}
