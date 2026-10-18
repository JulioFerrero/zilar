import { Duration, Effect, Fiber } from 'effect';
import type { Server } from 'node:http';
import net from 'node:net';
import type { WebSocket, WebSocketServer } from 'ws';
import type { DeskServer } from '../desk-server.ts';
import type { KeyRegistry } from '../keys.ts';
import { StreamMux, TunnelClosedError } from '../mux.ts';
import {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_UNKNOWN_TYPE,
  parseControlMessage,
} from '../protocol.ts';
import { closeQuietly } from '../ws-close.ts';
import { handleAuth, handleHello } from './handshake.ts';
import { handleReadyMessage } from './ready.ts';

export interface ServerConn {
  ws: WebSocket;
  state: 'hello' | 'auth' | 'ready';
  runnerId: string | null;
  nonce: Buffer | null;
  mux: StreamMux | null;
  lastPongAt: number;
  handshakeFiber: Fiber.Fiber<void, never> | null;
  pendingOpens: Map<number, PendingOpen>;
}

export interface PendingOpen {
  client: net.Socket;
  bridge: net.Socket;
  fail: (err: Error) => void;
}

/**
 * The mutable state of one `TunnelServer`; the class keeps it private and hands it to
 * the sibling modules.
 */
export interface ServerRuntime {
  readonly registry: KeyRegistry;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly handshakeTimeoutMs: number;
  readonly highWaterMarkBytes: number;
  readonly httpServer: Server;
  readonly wsServer: WebSocketServer;
  readonly conns: Set<ServerConn>;
  readonly live: Map<string, ServerConn>;
  readonly previews: Map<string, { runnerId: string; port: number }>;
  readonly desk: DeskServer;
  readonly unsubscribeRevoke: () => void;
  readonly heartbeatFiber: Fiber.Fiber<number, never>;
  closed: boolean;
  droppedFromDeadConns: number;
}

export function handleConnection(rt: ServerRuntime, ws: WebSocket): void {
  const conn: ServerConn = {
    ws,
    state: 'hello',
    runnerId: null,
    nonce: null,
    mux: null,
    lastPongAt: Date.now(),
    handshakeFiber: null,
    pendingOpens: new Map(),
  };
  rt.conns.add(conn);
  // One fiber per connection: the handshake deadline. It is interrupted
  // where the old `clearTimeout` ran (on ready, on drop and in `close`).
  conn.handshakeFiber = Effect.runFork(
    Effect.sleep(Duration.millis(rt.handshakeTimeoutMs)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (conn.state !== 'ready') {
            closeWith(conn, CLOSE_AUTH, 'handshake timeout');
          }
        }),
      ),
    ),
  );

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      handleBinary(conn, bytes);
    } else {
      handleText(rt, conn, data.toString('utf8'));
    }
  });
  ws.on('pong', () => {
    conn.lastPongAt = Date.now();
  });
  ws.on('close', (code: number, reason: Buffer) => {
    dropConn(rt, conn, code, reason.toString());
  });
  ws.on('error', () => {
    // The close handler below does the cleanup.
  });
}

export function dropConn(rt: ServerRuntime, conn: ServerConn, code: number, reason: string): void {
  const handshake = takeHandshakeFiber(conn);
  if (handshake !== null) {
    Effect.runFork(Fiber.interrupt(handshake));
  }
  rt.conns.delete(conn);
  if (conn.mux !== null) {
    rt.droppedFromDeadConns += conn.mux.unknownStreamsDropped;
    conn.mux.failAll(
      new TunnelClosedError(`connection closed (${code}): ${reason || 'no reason'}`),
    );
  }
  if (conn.runnerId !== null) {
    const wasLive = rt.live.get(conn.runnerId) === conn;
    if (wasLive) {
      rt.live.delete(conn.runnerId);
    }
    // A connection that only sent `hello`, or that a newer one replaced, must not fail
    // the requests that belong to the live connection.
    if (wasLive || (conn.state === 'ready' && !rt.live.has(conn.runnerId))) {
      rt.desk.failRunner(conn.runnerId);
    }
  }
}

export function closeWith(conn: ServerConn, code: number, reason: string): void {
  closeQuietly(conn.ws, code, reason);
}

export function takeHandshakeFiber(conn: ServerConn): Fiber.Fiber<void, never> | null {
  const fiber = conn.handshakeFiber;
  conn.handshakeFiber = null;
  return fiber;
}

export function handleBinary(conn: ServerConn, bytes: Buffer): void {
  if (conn.state !== 'ready' || conn.mux === null) {
    closeWith(conn, CLOSE_MALFORMED, 'binary frame before authentication');
    return;
  }
  conn.mux.handleBinary(bytes);
}

export function handleText(rt: ServerRuntime, conn: ServerConn, raw: string): void {
  const parsed = parseControlMessage(raw, 'runner-to-server');
  if (!parsed.ok) {
    closeWith(conn, parsed.code, parsed.reason);
    return;
  }
  const message = parsed.message;
  if (conn.state === 'hello') {
    if (message.type !== 'hello') {
      closeWith(conn, CLOSE_UNKNOWN_TYPE, 'expected hello first');
      return;
    }
    handleHello(rt, conn, message.runner_id, message.protocol_version);
    return;
  }
  if (conn.state === 'auth') {
    if (message.type !== 'auth') {
      closeWith(conn, CLOSE_UNKNOWN_TYPE, 'expected auth');
      return;
    }
    handleAuth(rt, conn, message.signature);
    return;
  }
  handleReadyMessage(rt, conn, message);
}
