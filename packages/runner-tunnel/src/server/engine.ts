// effect-plain: moved unchanged from packages/runner-tunnel/src/server.ts (size split)
import type { Socket } from 'node:net';
import { TunnelHttpAgent, createLoopbackPair } from '../http-agent.ts';
import { TunnelClosedError, attachSocketToStream } from '../mux.ts';
import type { ServerRuntime } from './conn.ts';

/**
 * Open a stream to a runner port and return the local end as a connected
 * TCP socket. Refusals and drops destroy the socket with a TunnelClosedError.
 */
export async function openEngineStream(
  rt: ServerRuntime,
  runnerId: string,
  port: number,
): Promise<Socket> {
  const conn = rt.live.get(runnerId);
  if (conn === undefined || conn.state !== 'ready' || conn.mux === null) {
    throw new TunnelClosedError(`runner ${runnerId} is not connected`);
  }
  const mux = conn.mux;
  const streamId = mux.allocateId();
  const { client, server: bridge } = await createLoopbackPair();
  if (conn.state !== 'ready') {
    client.destroy();
    bridge.destroy();
    throw new TunnelClosedError(`runner ${runnerId} disconnected while opening the stream`);
  }
  attachSocketToStream(mux, streamId, bridge, {
    onStreamFailed: (err) => {
      if (!client.destroyed) {
        client.destroy(err);
      }
    },
  });
  const fail = (err: Error): void => {
    conn.pendingOpens.delete(streamId);
    mux.unregisterStream(streamId);
    if (!client.destroyed) {
      client.destroy(err);
    }
    if (!bridge.destroyed) {
      bridge.destroy();
    }
  };
  conn.pendingOpens.set(streamId, { client, bridge, fail });
  bridge.on('close', () => {
    conn.pendingOpens.delete(streamId);
  });
  try {
    mux.sendControl({ type: 'tunnel.open', stream_id: streamId, port });
  } catch (err) {
    fail(err instanceof Error ? err : new TunnelClosedError('send failed'));
    throw err;
  }
  return client;
}

/** An `http.Agent` that reaches one runner's exposed ports through the tunnel. */
export function engineAgent(rt: ServerRuntime, runnerId: string): TunnelHttpAgent {
  return new TunnelHttpAgent((port) => openEngineStream(rt, runnerId, port));
}
