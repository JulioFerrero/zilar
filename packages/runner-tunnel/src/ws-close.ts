// effect-plain: closes a WebSocket and swallows errors; no Effect runtime.
import type { WebSocket } from 'ws';

/**
 * Close a WebSocket and swallow every error: the peer is often already gone, and
 * callers treat a failed close as nothing to do. No code terminates immediately; with
 * a code it closes gracefully.
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
