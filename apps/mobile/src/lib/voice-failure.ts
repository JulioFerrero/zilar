import type { SendFailureReason } from '@zilar/chat-core';

/**
 * Exactly the shared `SendFailureReason` buckets, so the message keeps the shared type.
 */
export type VoiceFailureReason = SendFailureReason;

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
