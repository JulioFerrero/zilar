// effect-plain: the heartbeat sweep runs on one Effect fiber in server.ts.
import { closeQuietly } from '../ws-close.ts';
import type { ServerRuntime } from './conn.ts';

/** Terminate ready connections that stopped responding, ping the rest. */
export function checkHeartbeats(rt: ServerRuntime): void {
  const now = Date.now();
  for (const conn of rt.conns) {
    if (conn.state !== 'ready') {
      continue;
    }
    if (now - conn.lastPongAt > rt.heartbeatTimeoutMs) {
      closeQuietly(conn.ws);
    } else {
      try {
        conn.ws.ping();
      } catch {
        // The next check terminates it.
      }
    }
  }
}
