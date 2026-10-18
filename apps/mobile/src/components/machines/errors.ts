import { MachinesApiError } from '../../lib/machines-api';

export interface MachinesErrorInfo {
  message: string;
}

// Maps the machine error codes to fixed plain sentences, mirroring web's
// `components/machines/errors.ts`. Unknown codes answer `fallback`, because
// user-facing text is never the server's raw message.
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
      case 'invalid_transition':
        return { message: 'That machine changed. Reload the list and try again.' };
      default:
        return { message: fallback };
    }
  }
  return { message: error instanceof Error ? error.message : fallback };
}
