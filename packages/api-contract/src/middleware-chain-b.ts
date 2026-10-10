// The middleware tags of chain B's groups (T-0893). They live apart from
// `middleware.ts` so parallel chains never edit the same lines. A tag's
// identity is its key; none is `requiredForClient` and none declares an
// error schema, so a derived client skips them.

import { HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser } from './middleware';

/** Any audit query decode failure is the fixed text `Invalid audit query`. */
export class AuditSchemaErrors extends HttpApiMiddleware.Service<AuditSchemaErrors>()(
  'zilar/effect/http/AuditSchemaErrors',
) {}

/** Renders an AI-memory params, query or payload decode failure as 400 `invalid_request`. */
export class AiMemorySchemaErrors extends HttpApiMiddleware.Service<AiMemorySchemaErrors>()(
  'zilar/effect/http/AiMemorySchemaErrors',
) {}

/**
 * The AI-memory write budget. It runs before the query or payload is decoded,
 * so an invalid request still spends budget.
 */
export class AiMemoryWriteRateLimit extends HttpApiMiddleware.Service<
  AiMemoryWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/AiMemoryWriteRateLimit') {}

/** A decision payload decode failure is 400 `invalid_request`, "Invalid decision body". */
export class ApprovalsSchemaErrors extends HttpApiMiddleware.Service<ApprovalsSchemaErrors>()(
  'zilar/effect/http/ApprovalsSchemaErrors',
) {}

/** Renders an AI payload decode failure as 400 `invalid_request`. */
export class AisSchemaErrors extends HttpApiMiddleware.Service<AisSchemaErrors>()(
  'zilar/effect/http/AisSchemaErrors',
) {}

/**
 * The 503 availability gate of the AI routes that need LiteLLM and the key
 * cipher. It runs before the payload is decoded: a malformed body on an
 * unconfigured server still answers 503, not 400.
 */
export class AisConfigured extends HttpApiMiddleware.Service<
  AisConfigured,
  { requires: CurrentUser }
>()('zilar/effect/http/AisConfigured') {}

/** Renders a tools params decode failure as 400 `invalid_request`. */
export class ToolsSchemaErrors extends HttpApiMiddleware.Service<ToolsSchemaErrors>()(
  'zilar/effect/http/ToolsSchemaErrors',
) {}

/** Renders a routines params decode failure as 400 `invalid_request`. */
export class RoutinesSchemaErrors extends HttpApiMiddleware.Service<RoutinesSchemaErrors>()(
  'zilar/effect/http/RoutinesSchemaErrors',
) {}
