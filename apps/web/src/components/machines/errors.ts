import { ApiError } from '@/lib/api';

export function machineErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'pairing_code_limit':
        return 'You already have unused pairing codes. Use one or wait for it to expire.';
      case 'rate_limited':
        return 'Too many pairing codes. Try again in a few minutes.';
      case 'revoke_first':
        return 'Revoke the machine before deleting it.';
      case 'not_found':
        return 'That machine no longer exists.';
      case 'network_error':
        return 'Could not reach the server.';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : fallback;
}
