import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { lenientLiterals } from './lenient';
import { HandlesCheckRateLimit, HandlesSchemaErrors, Session } from './middleware';

export const HANDLE_CHECK_REASONS = ['invalid', 'reserved', 'taken'] as const;

export type HandleCheckReason = (typeof HANDLE_CHECK_REASONS)[number];

// The server answers a decode failure with a success body (`{ available: false, reason: 'invalid' }`),
// so a client answers a handle outside 1..64 characters itself before the derived client encodes the query.
export const HANDLE_CHECK_MIN = 1;
export const HANDLE_CHECK_MAX = 64;

export const HandleCheckQuery = Schema.Struct({
  handle: Schema.String.check(
    Schema.isMinLength(HANDLE_CHECK_MIN),
    Schema.isMaxLength(HANDLE_CHECK_MAX),
  ),
  kind: Schema.optional(Schema.Literals(['user', 'group'])),
});

export const HandleCheck = Schema.Struct({
  available: Schema.Boolean,
  reason: Schema.optional(lenientLiterals(HANDLE_CHECK_REASONS, 'invalid')),
});

export type HandleCheck = typeof HandleCheck.Type;

// 1..64 characters; the store re-checks the shape and the reserved words.
export const ClaimHandlePayload = Schema.Struct({
  handle: Schema.String.check(
    Schema.isMinLength(HANDLE_CHECK_MIN),
    Schema.isMaxLength(HANDLE_CHECK_MAX),
  ),
});

export const ClaimedHandle = Schema.Struct({ handle: Schema.String });

export type ClaimedHandle = typeof ClaimedHandle.Type;

export const HandlesGroup = HttpApiGroup.make('handles')
  .add(
    HttpApiEndpoint.get('check', '/handles/check', {
      query: HandleCheckQuery,
      success: HandleCheck,
    }).middleware(HandlesCheckRateLimit),
    HttpApiEndpoint.put('claim', '/me/handle', {
      payload: ClaimHandlePayload,
      success: ClaimedHandle,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(HandlesSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
