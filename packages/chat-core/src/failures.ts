import type { SendFailureReason } from './types';

/**
 * The user-safe sentence shown under a failed send (T-0168): one fixed string
 * per reason, never raw error text. Exhaustive by construction: every union
 * member maps to a label.
 */
export function sendFailureLabel(reason: SendFailureReason): string {
  switch (reason) {
    case 'too_large':
      return 'File too large to send';
    case 'unsupported_file':
      return 'File type not supported';
    case 'server_unavailable':
      return 'Server unavailable';
    case 'upload_refused':
      return 'Upload refused';
    case 'network':
      return 'Network error';
    case 'timed_out':
      return 'Timed out';
  }
}
