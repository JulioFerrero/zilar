import { Effect, Fiber } from 'effect';
import { randomNonce, verifyNonce } from '../keys.ts';
import { StreamMux } from '../mux.ts';
import { CLOSE_AUTH, CLOSE_VERSION, isAcceptedProtocolVersion } from '../protocol.ts';
import { closeQuietly } from '../ws-close.ts';
import { closeWith, takeHandshakeFiber } from './conn.ts';
import type { ServerConn, ServerRuntime } from './conn.ts';

export function handleHello(
  rt: ServerRuntime,
  conn: ServerConn,
  runnerId: string,
  protocolVersion: number,
): void {
  if (!isAcceptedProtocolVersion(protocolVersion)) {
    closeWith(conn, CLOSE_VERSION, `unsupported protocol version ${protocolVersion}`);
    return;
  }
  const publicKey = rt.registry.getPublicKey(runnerId);
  if (publicKey === null) {
    closeWith(conn, CLOSE_AUTH, 'unknown runner');
    return;
  }
  conn.runnerId = runnerId;
  conn.nonce = randomNonce();
  conn.state = 'auth';
  try {
    conn.ws.send(JSON.stringify({ type: 'challenge', nonce: conn.nonce.toString('base64') }));
  } catch {
    // The close handler cleans up.
  }
}

export function handleAuth(rt: ServerRuntime, conn: ServerConn, signature: string): void {
  const runnerId = conn.runnerId;
  const nonce = conn.nonce;
  conn.nonce = null;
  if (runnerId === null || nonce === null) {
    closeWith(conn, CLOSE_AUTH, 'authentication failed');
    return;
  }
  // Re-read the key: it may have been revoked mid-handshake.
  const publicKey = rt.registry.getPublicKey(runnerId);
  if (publicKey === null || !verifyNonce(publicKey, nonce, signature)) {
    closeWith(conn, CLOSE_AUTH, 'authentication failed');
    return;
  }
  const previous = rt.live.get(runnerId);
  if (previous !== undefined && previous !== conn) {
    closeQuietly(previous.ws, 1000, 'replaced by a new connection');
  }
  conn.state = 'ready';
  conn.mux = new StreamMux(conn.ws, 2, { highWaterMarkBytes: rt.highWaterMarkBytes });
  conn.lastPongAt = Date.now();
  const handshake = takeHandshakeFiber(conn);
  if (handshake !== null) {
    Effect.runFork(Fiber.interrupt(handshake));
  }
  rt.live.set(runnerId, conn);
  try {
    conn.ws.send(JSON.stringify({ type: 'ready' }));
  } catch {
    // The close handler cleans up.
  }
}
