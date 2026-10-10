// Handles (T-0498, moved to the contract by T-0894): the live availability
// check for a typed `@handle` and the claim of the caller's own handle.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { HandlesCheckRateLimit, HandlesSchemaErrors } from './chain-c-middleware';
import { lenientLiterals } from './lenient';
import { Session } from './middleware';

export const HANDLE_CHECK_REASONS = ['invalid', 'reserved', 'taken'] as const;

export type HandleCheckReason = (typeof HANDLE_CHECK_REASONS)[number];

// The check query. The server answers a decode failure with a success body
// (`{ available: false, reason: 'invalid' }`), so a client that must see that
// answer for a handle outside 1..64 characters answers it itself, because the
// derived client encodes the query before it sends it.
export const HANDLE_CHECK_MIN = 1;
export const HANDLE_CHECK_MAX = 64;

export const HandleCheckQuery = Schema.Struct({
  handle: Schema.String.check(
    Schema.isMinLength(HANDLE_CHECK_MIN),
    Schema.isMaxLength(HANDLE_CHECK_MAX),
  ),
  // `kind=group` asks for a public group or channel; absent (or `user`) keeps
  // the user answer.
  kind: Schema.optional(Schema.Literals(['user', 'group'])),
});

export const HandleCheck = Schema.Struct({
  available: Schema.Boolean,
  // An unknown reason from a newer server reads as `invalid`.
  reason: Schema.optional(lenientLiterals(HANDLE_CHECK_REASONS, 'invalid')),
});

export type HandleCheck = typeof HandleCheck.Type;

// The claim body: 1..64 characters; the store re-checks the shape and the
// reserved words. The payload decode is strict, so an excess key fails.
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
