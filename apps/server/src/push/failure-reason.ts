import { FcmSendError } from './fcm';

// The column cap (migration 0054's check); every reason here is already
// short, and the slice guards a future transport.
export const PUSH_FAILURE_REASON_MAX_LENGTH = 64;

/** The short reason stored when a send fails: an FCM rejection keeps its
 * error code or falls back to `http-<status>`, a Web Push rejection its HTTP
 * status. The registration token, access token and request body never reach
 * this string. */
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
