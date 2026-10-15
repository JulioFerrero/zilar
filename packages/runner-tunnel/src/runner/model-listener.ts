// effect-plain: moved unchanged from packages/runner-tunnel/src/runner.ts (size split)
import net from 'node:net';
import { attachSocketToStream, type StreamMux } from '../mux.ts';

/**
 * Listen on 127.0.0.1 as the desk's LLM base URL. Every accepted socket becomes
 * one tunnel stream; `getMux` returns the live connection or null when there is
 * none, in which case the socket is dropped.
 */
export async function startModelListener(getMux: () => StreamMux | null): Promise<net.Server> {
  const server = net.createServer((socket) => {
    const mux = getMux();
    if (mux === null) {
      socket.destroy();
      return;
    }
    const streamId = mux.allocateId();
    attachSocketToStream(mux, streamId, socket);
    try {
      mux.sendControl({ type: 'model.open', stream_id: streamId });
    } catch {
      socket.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1 only: the desk's LLM key travels here, so it must never be
    // reachable from the LAN. The test asserts the bound address.
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
