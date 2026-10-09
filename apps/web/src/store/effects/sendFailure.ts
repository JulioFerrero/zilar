import type { SendFailureReason } from '@zilar/chat-core';

/**
 * Maps any send-pipeline error to a fixed user-safe `SendFailureReason`
 * (T-0168). Raw error text, URLs and tokens never reach the UI or the logs:
 * the tables below read only the error class (`VoiceError`/`AttachmentError`
 * code, HTTP status, offline state).
 */
export function sendFailureReasonFor(error: unknown, offline: boolean): SendFailureReason {
  if (offline) {
    return 'network';
  }
  const code = errorCodeOf(error);
  if (code === 'too_large' || code === 'voice_too_large' || code === 'empty_file') {
    return 'too_large';
  }
  if (code === 'unsupported' || code === 'voice_empty' || code === 'invalid_response') {
    return 'unsupported_file';
  }
  if (code === 'convert_failed' || code === 'voice_failed' || code.startsWith('voice_')) {
    return 'server_unavailable';
  }
  if (code === 'upload_refused' || code === 'upload_failed') {
    return 'upload_refused';
  }
  if (code === 'timed_out') {
    return 'timed_out';
  }
  if (code === 'network_error' || code === 'network') {
    return 'network';
  }
  const status = httpStatusOf(error);
  if (status !== undefined) {
    if (status === 413) {
      return 'too_large';
    }
    if (status === 415) {
      return 'unsupported_file';
    }
    if (status === 403 || status === 404 || status === 409) {
      return 'upload_refused';
    }
    if (status >= 500) {
      return 'server_unavailable';
    }
    return 'network';
  }
  if (error instanceof Error && /timed out|timeout|aborted/i.test(error.message)) {
    return 'timed_out';
  }
  return 'network';
}

/** The typed `code` of a `VoiceError`/`AttachmentError`, or `''`. */
function errorCodeOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

/** The HTTP status of an `ApiError`, or undefined. */
function httpStatusOf(error: unknown): number | undefined {
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
