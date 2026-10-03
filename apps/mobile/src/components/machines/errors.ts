import { MachinesApiError } from '../../lib/machines-api';

export interface MachinesErrorInfo {
  /** A clear message for the user; never a raw code or a stack trace. */
  message: string;
}

// Maps the machine error codes in the T-0068 contract to plain language,
// mirroring web's `components/machines/errors.ts`. Most codes keep the
// server's own message; the few known ones get friendlier.
export function describeMachinesError(error: unknown, fallback: string): MachinesErrorInfo {
  if (error instanceof MachinesApiError) {
    switch (error.code) {
      case 'pairing_code_limit':
        return {
          message: 'You already have unused pairing codes. Use one or wait for it to expire.',
        };
      case 'rate_limited':
        return { message: 'Too many requests. Try again in a few minutes.' };
      case 'revoke_first':
        return { message: 'Revoke the machine before deleting it.' };
      case 'not_found':
        return { message: 'That machine no longer exists.' };
      case 'network_error':
        return { message: 'Could not reach the server.' };
      default:
        return { message: error.message };
    }
  }
  return { message: error instanceof Error ? error.message : fallback };
}
