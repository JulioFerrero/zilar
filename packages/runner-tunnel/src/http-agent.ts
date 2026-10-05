import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import type { Duplex } from 'node:stream';
import { TunnelClosedError } from './mux.ts';

/**
 * Open one tunnel stream and return the local end as a connected TCP socket.
 * The socket is a localhost loopback pair whose far end is bridged to the
 * stream, so node's HTTP stack only ever sees a real `net.Socket`. The extra
 * hop costs a fraction of a millisecond and keeps every HTTP behavior
 * (chunked bodies, SSE, trailers, error events) exactly as usual.
 */
export type TunnelDialer = (port: number) => Promise<net.Socket>;

export async function createLoopbackPair(): Promise<{ client: net.Socket; server: net.Socket }> {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      listener.removeListener('error', reject);
      resolve();
    });
  });
  const address = listener.address();
  if (typeof address === 'string' || address === null) {
    listener.close();
    throw new TunnelClosedError('loopback listener has no port');
  }
  const accepted = once(listener, 'connection') as Promise<[net.Socket]>;
  const client = net.connect(address.port, '127.0.0.1');
  client.setNoDelay(true);
  const [server] = await accepted;
  server.setNoDelay(true);
  listener.close();
  return { client, server };
}

/**
 * An `http.Agent` whose connections travel through the tunnel. The `port` of
 * the request selects the runner port to open, exactly like a direct request;
 * the host is ignored because the tunnel decides where bytes go.
 */
export class TunnelHttpAgent extends http.Agent {
  private readonly dial: TunnelDialer;

  constructor(dial: TunnelDialer) {
    super({ keepAlive: false });
    this.dial = dial;
  }

  override createConnection(
    options: http.ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const port = typeof options.port === 'number' ? options.port : Number(options.port ?? 80);
    if (callback === undefined) {
      throw new TunnelClosedError('tunnel agent needs an async createConnection callback');
    }
    const fail = callback as (err: Error | null, stream?: Duplex) => void;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(new TunnelClosedError(`invalid tunnel port ${String(options.port)}`));
      return null;
    }
    this.dial(port).then(
      (socket) => {
        callback(null, socket);
      },
      (err: unknown) => {
        fail(err instanceof Error ? err : new TunnelClosedError('dial failed'));
      },
    );
    return null;
  }
}
