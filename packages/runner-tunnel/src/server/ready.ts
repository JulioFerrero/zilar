import { TunnelClosedError } from '../mux.ts';
import { CLOSE_UNKNOWN_TYPE, type ControlMessage } from '../protocol.ts';
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
