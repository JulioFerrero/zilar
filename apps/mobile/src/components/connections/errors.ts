import { ConnectionsApiError } from '../../lib/connections-api';

export interface ConnectionsErrorInfo {
  /** A clear message for the user; never a raw code or a stack trace. */
  message: string;
}

// Maps the connection error codes to plain language. Most codes keep the
// server's own message; the few known ones get friendlier.
export function describeConnectionsError(error: unknown, fallback: string): ConnectionsErrorInfo {
  if (error instanceof ConnectionsApiError) {
    switch (error.code) {
      case 'connection_in_use':
        return { message: 'An AI still uses this connection. Switch the AI first.' };
      case 'rate_limited':
        return { message: 'Too many requests. Try again in a few minutes.' };
      case 'not_found':
        return { message: 'That connection no longer exists.' };
      case 'network_error':
        return { message: 'Could not reach the server.' };
      default:
        return { message: error.message };
    }
  }
  return { message: error instanceof Error ? error.message : fallback };
}
