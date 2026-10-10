/**
 * Why a voice send failed and the copy the bubble shows (T-0154). Split out
 * of `voice-native.ts` (T-1030).
 */

import type { SendFailureReason } from '@zilar/chat-core';

/**
 * Why a voice send failed: exactly the shared `SendFailureReason` buckets
 * (finding 4), reused from `chat-core` so the message keeps the shared
 * type. Mobile maps its voice pipeline errors onto these buckets.
 */
export type VoiceFailureReason = SendFailureReason;

/** Maps a pipeline error to the fixed failure bucket the bubble shows. */
export function voiceFailureReasonFor(error: unknown, offline: boolean): VoiceFailureReason {
  if (offline) {
    return 'network';
  }
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : '';
  if (code === 'voice_too_long' || code === 'voice_too_large' || code === 'too_large') {
    return 'too_large';
  }
  if (code === 'voice_empty' || code === 'voice_not_audio' || code === 'invalid_response') {
    return 'unsupported_file';
  }
  if (code === 'voice_too_short') {
    return 'unsupported_file';
  }
  if (
    code === 'convert_failed' ||
    code === 'voice_failed' ||
    (typeof code === 'string' && code.startsWith('voice_'))
  ) {
    return 'server_unavailable';
  }
  if (code === 'upload_refused' || code === 'upload_failed') {
    return 'upload_refused';
  }
  if (code === 'network_error' || code === 'network') {
    return 'network';
  }
  return 'server_unavailable';
}

/** The plain copy a failed voice bubble shows for its reason. */
export function voiceErrorCopy(reason: VoiceFailureReason): string {
  if (reason === 'network') {
    return 'Could not send. Check your connection.';
  }
  if (reason === 'too_large') {
    return 'That recording is too long to send.';
  }
  if (reason === 'unsupported_file') {
    return 'That recording could not be read.';
  }
  if (reason === 'upload_refused') {
    return 'Could not upload the recording.';
  }
  if (reason === 'server_unavailable') {
    return 'Could not send the voice message. Try again.';
  }
  return 'Sending took too long. Try again.';
}
