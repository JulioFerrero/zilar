// effect-plain: moved unchanged from packages/runner-tunnel/src/server.ts (size split)
import net from 'node:net';
import { StreamMux, TunnelClosedError, attachSocketToStream } from '../mux.ts';
import { CLOSE_MALFORMED, CLOSE_UNKNOWN_TYPE, type ControlMessage } from '../protocol.ts';
import { closeWith } from './conn.ts';
import type { ServerConn, ServerRuntime } from './conn.ts';

export function handleReadyMessage(
  rt: ServerRuntime,
  conn: ServerConn,
  message: ControlMessage,
): void {
  const mux = conn.mux;
  if (mux === null) {
    return;
  }
  switch (message.type) {
    case 'model.open':
      handleModelOpen(rt, conn, mux, message.stream_id);
      break;
    case 'tunnel.refused':
      failStream(conn, message.stream_id, `tunnel refused: ${message.reason}`);
      break;
    case 'tunnel.closed':
      failStream(conn, message.stream_id, `tunnel closed by runner: ${message.reason}`);
      break;
    case 'tunnel.pause':
      mux.handlePause(message.stream_id);
      break;
    case 'tunnel.resume':
      mux.handleResume(message.stream_id);
      break;
    case 'heartbeat':
      // Validated and accepted; liveness itself is tracked by ping/pong.
      break;
    default:
      if (rt.desk.route(conn.runnerId, message)) break;
      closeWith(conn, CLOSE_UNKNOWN_TYPE, 'message not allowed after authentication');
      break;
  }
}

export function failStream(conn: ServerConn, streamId: number, reason: string): void {
  // Only the connection that sent the message is affected: stream ids are
  // allocated per connection, so another runner routinely uses the same id.
  const pending = conn.pendingOpens.get(streamId);
  if (pending !== undefined) {
    pending.fail(new TunnelClosedError(reason));
    return;
  }
  if (conn.mux !== null) {
    conn.mux.failStream(streamId, new TunnelClosedError(reason));
  }
}

function handleModelOpen(
  rt: ServerRuntime,
  conn: ServerConn,
  mux: StreamMux,
  streamId: number,
): void {
  // Stream ids are split by parity: the server opens even ids, the runner
  // odd ones. An even or already-live id is a buggy or hostile runner.
  if (streamId % 2 === 0 || mux.hasStream(streamId)) {
    closeWith(conn, CLOSE_MALFORMED, `bad model.open stream id ${streamId}`);
    return;
  }
  // The bytes are piped to the one configured gateway, whatever they say:
  // absolute-form URLs and foreign Host headers still land on the gateway
  // because the destination never comes from the request.
  const gateway = net.connect(rt.gatewayPort, rt.gatewayHost);
  attachSocketToStream(mux, streamId, gateway);
}
