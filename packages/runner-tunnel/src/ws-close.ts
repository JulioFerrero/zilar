// effect-plain: moved unchanged from packages/runner-tunnel/src/runner.ts and server.ts (size split)
import type { WebSocket } from 'ws';

/**
 * Close a WebSocket and swallow every error: the peer is often already gone, and
 * every caller treats a failed close as "nothing left to do". With no code the
 * socket is terminated immediately (the hard close some teardown paths need);
 * with a code it is closed gracefully.
 */
export function closeQuietly(ws: WebSocket, code?: number, reason?: string): void {
  try {
    if (code === undefined) {
      ws.terminate();
    } else {
      ws.close(code, reason);
    }
  } catch {
    // Already gone.
  }
}
