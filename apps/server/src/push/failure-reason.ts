import { FcmSendError } from './fcm';

// The column cap (migration 0054's `push_subscriptions_last_failure_check`).
// Every reason this module returns is already short; the slice is the guard
// that keeps a produced string inside the column even if a transport changes.
export const PUSH_FAILURE_REASON_MAX_LENGTH = 64;

/**
 * The short, user-facing reason stored with `failedAt` when a send fails. An
 * FCM rejection keeps its error code (`UNREGISTERED`, `SENDER_ID_MISMATCH`,
 * `QUOTA_EXCEEDED`, `UNAVAILABLE`, …) or falls back to `http-<status>`; a Web
 * Push rejection is its HTTP status. The registration token, the access token
 * and the request body never reach this string.
 */
export function pushFailureReason(error: unknown): string {
  return rawReason(error).slice(0, PUSH_FAILURE_REASON_MAX_LENGTH);
}

function rawReason(error: unknown): string {
  if (error instanceof FcmSendError) {
    return error.code ?? `http-${error.status}`;
  }
  const status = statusCodeOf(error);
  return status === null ? 'unknown' : `http-${status}`;
}

// Web Push rejects with `webpush.WebPushError`, which carries `statusCode`;
// matching it structurally keeps this module independent of the package.
function statusCodeOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : null;
}
