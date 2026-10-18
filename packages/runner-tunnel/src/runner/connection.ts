import net from 'node:net';
import { Duration, Effect, Fiber, Schedule } from 'effect';
import type { WebSocket } from 'ws';
import { StreamMux, TunnelClosedError, attachSocketToStream } from '../mux.ts';
import {
  CLOSE_MALFORMED,
  CLOSE_UNKNOWN_TYPE,
  parseControlMessage,
  type ControlMessage,
} from '../protocol.ts';
import { closeQuietly } from '../ws-close.ts';
import type { RunnerRuntime } from './lifecycle.ts';

/** How often a ready connection sends a liveness heartbeat. */
const HEARTBEAT_INTERVAL_MS = 10000;

export function installReadyConnection(rt: RunnerRuntime, ws: WebSocket): void {
  const mux = new StreamMux(ws, 1, { highWaterMarkBytes: rt.highWaterMarkBytes });
  rt.mux = mux;
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      const parsed = parseControlMessage(data.toString('utf8'), 'server-to-runner');
      if (!parsed.ok) {
        closeQuietly(ws, parsed.code, parsed.reason);
        return;
      }
      routeControl(rt, mux, parsed.message);
    } else {
      mux.handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    }
  });
  ws.on('close', (code: number) => {
    teardownConnection(rt, mux, ws, code);
  });
  ws.on('error', () => {
    // The close event below does the cleanup.
  });
  startHeartbeat(rt, mux);
}

export function startHeartbeat(rt: RunnerRuntime, mux: StreamMux): void {
  // Replace a previous heartbeat: an orphaned fiber would ping a dead mux and, since
  // Effect timers are not unref'd, keep the process alive.
  void interruptHeartbeat(rt);
  const heartbeat = Effect.repeat(
    Effect.sync(() => {
      try {
        mux.sendControl({ type: 'heartbeat', at: Date.now() });
      } catch {
        // The tunnel is dying; the close handler cleans up.
      }
    }).pipe(Effect.catchDefect(() => Effect.void)),
    Schedule.spaced(Duration.millis(HEARTBEAT_INTERVAL_MS)),
  ).pipe(Effect.delay(Duration.millis(HEARTBEAT_INTERVAL_MS)));
  rt.heartbeatFiber = Effect.runFork(heartbeat);
}

export async function interruptHeartbeat(rt: RunnerRuntime): Promise<void> {
  const fiber = rt.heartbeatFiber;
  rt.heartbeatFiber = null;
  if (fiber !== null) {
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
}

export function teardownConnection(
  rt: RunnerRuntime,
  mux: StreamMux,
  ws: WebSocket,
  code: number,
): void {
  if (rt.ws === ws) {
    rt.ws = null;
  }
  rt.lastCloseCode = code;
  if (rt.mux === mux) {
    rt.mux = null;
  }
  void interruptHeartbeat(rt);
  mux.failAll(new TunnelClosedError('connection to the server was lost'));
  notifyClosed(rt);
}

export function notifyClosed(rt: RunnerRuntime): void {
  for (const resolve of rt.closeResolvers.splice(0)) {
    resolve();
  }
}

export function routeControl(rt: RunnerRuntime, mux: StreamMux, message: ControlMessage): void {
  switch (message.type) {
    case 'tunnel.open':
      handleTunnelOpen(rt, mux, message.stream_id, message.port);
      break;
    case 'tunnel.closed':
      mux.failStream(
        message.stream_id,
        new TunnelClosedError(`server closed stream: ${message.reason}`),
      );
      break;
    case 'tunnel.pause':
      mux.handlePause(message.stream_id);
      break;
    case 'tunnel.resume':
      mux.handleResume(message.stream_id);
      break;
    case 'desk.provision':
    case 'desk.exec':
    case 'desk.stop':
      rt.deskRunner.handle(mux, message);
      break;
    case 'challenge':
    case 'ready':
      if (rt.ws !== null) {
        closeQuietly(rt.ws, CLOSE_UNKNOWN_TYPE, `unexpected ${message.type}`);
      }
      break;
    default:
      if (rt.ws !== null) {
        closeQuietly(rt.ws, CLOSE_UNKNOWN_TYPE, 'message not allowed');
      }
      break;
  }
}

function handleTunnelOpen(rt: RunnerRuntime, mux: StreamMux, streamId: number, port: number): void {
  // Stream ids are split by parity: the server opens even ids, this runner
  // odd ones. An odd or already-live id is a buggy or hostile server.
  if (streamId % 2 !== 0 || mux.hasStream(streamId)) {
    if (rt.ws !== null) {
      closeQuietly(rt.ws, CLOSE_MALFORMED, `bad tunnel.open stream id ${streamId}`);
    }
    return;
  }
  if (!rt.exposedPorts.includes(port)) {
    try {
      mux.sendControl({
        type: 'tunnel.refused',
        stream_id: streamId,
        reason: `port ${port} is not exposed`,
      });
    } catch {
      // The tunnel is dying anyway.
    }
    return;
  }
  const desk = net.connect(port, '127.0.0.1');
  attachSocketToStream(mux, streamId, desk);
}
