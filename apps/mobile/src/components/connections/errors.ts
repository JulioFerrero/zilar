import { ConnectionsApiError } from '../../lib/connections-api';

export interface ConnectionsErrorInfo {
  /** A clear message for the user; never a raw code or a stack trace. */
  message: string;
}

// Maps the connection error codes to fixed plain sentences. Unknown codes
// answer the `fallback` the call site passes: user-facing text is never the
// server's raw message.
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
      case 'key_unreadable':
        return { message: 'The stored key could not be read. Remove it and add it again.' };
      case 'connections_unavailable':
        return { message: 'Connections are not set up on this server.' };
      default:
        return { message: fallback };
    }
  }
  return { message: error instanceof Error ? error.message : fallback };
}
