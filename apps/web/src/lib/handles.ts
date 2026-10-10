import { Effect } from 'effect';
import {
  ApiError,
  checkHandle as apiCheckHandle,
  claimHandle as apiClaimHandle,
  type HandleCheck,
} from './api';

export { ApiError };

// The handle rules (shapes, reserved words, suggestions) live in
// @zilar/protocol and are shared with the server, which is the authority.
export {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  RESERVED_HANDLES,
  classifyHandle,
  isReservedHandle,
  isValidHandleShape,
  normalizeHandle,
  suggestHandle as suggestHandleFor,
  type HandleAvailabilityReason,
} from '@zilar/protocol';

// The api.ts rejection passes through unchanged: HandlePage matches `ApiError`
// with `instanceof`, which `fromApi` would replace with an `ApiFailure`.
const passThrough = <A>(call: () => Promise<A>): Promise<A> =>
  Effect.runPromise(
    Effect.tryPromise({
      try: call,
      catch: (cause) => cause,
    }),
  );

export function checkHandle(handle: string): Promise<HandleCheck> {
  return passThrough(() => apiCheckHandle(handle));
}

export function claimHandle(handle: string): Promise<{ handle: string }> {
  return passThrough(() => apiClaimHandle(handle));
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'rate_limited';
}
