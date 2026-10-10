// The middleware tags of chain D's groups (T-0895): stickers, gifs, machines,
// integrations, push, backgrounds, voice, media, auth. They live apart from
// `middleware.ts` so parallel chains never edit the same lines. A tag's
// identity is its key; none is `requiredForClient` and none declares an error
// schema, so a derived client skips them.

import { HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser } from './middleware';

/**
 * Renders a params, query or payload decode failure as 400 `invalid_request`.
 * It plays the role of `SchemaErrors` in `apps/server/src/effect/http-core.ts`
 * for the groups that moved into the contract.
 */
export class ChainDSchemaErrors extends HttpApiMiddleware.Service<ChainDSchemaErrors>()(
  'zilar/effect/http/ChainDSchemaErrors',
) {}

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

/**
 * Renders a sticker payload decode failure as 400 `invalid_request` with the
 * fixed per-route message (picked by the request path).
 */
export class StickersSchemaErrors extends HttpApiMiddleware.Service<StickersSchemaErrors>()(
  'zilar/effect/http/StickersSchemaErrors',
) {}

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
