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

/** Renders a pins query or payload decode failure as 400 `invalid_request`. */
export class PinsSchemaErrors extends HttpApiMiddleware.Service<PinsSchemaErrors>()(
  'zilar/effect/http/PinsSchemaErrors',
) {}

/**
 * The pins write budget. It runs before the payload is decoded, so an invalid
 * body still spends budget.
 */
export class PinsWriteRateLimit extends HttpApiMiddleware.Service<
  PinsWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/PinsWriteRateLimit') {}
