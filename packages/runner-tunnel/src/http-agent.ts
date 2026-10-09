import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { Deferred, Effect } from 'effect';
import { TunnelClosedError } from './mux.ts';

/**
 * Open one tunnel stream and return the local end as a connected TCP socket.
 * The socket is a localhost loopback pair whose far end is bridged to the
 * stream, so node's HTTP stack only ever sees a real `net.Socket`. The extra
 * hop costs a fraction of a millisecond and keeps every HTTP behavior
 * (chunked bodies, SSE, trailers, error events) exactly as usual.
 */
export type TunnelDialer = (port: number) => Promise<net.Socket>;

const listening = (listener: net.Server): Effect.Effect<void, Error> =>
  Effect.callback<void, Error>((resume) => {
    const onError = (err: Error): void => resume(Effect.fail(err));
    listener.once('error', onError);
    listener.listen(0, '127.0.0.1', () => {
      listener.removeListener('error', onError);
      resume(Effect.void);
    });
  });

export const createLoopbackPairEffect: Effect.Effect<
  { client: net.Socket; server: net.Socket },
  Error
> = Effect.gen(function* () {
  const listener = net.createServer();
  yield* listening(listener);
  const address = listener.address();
  if (typeof address === 'string' || address === null) {
    listener.close();
    return yield* Effect.fail(new TunnelClosedError('loopback listener has no port'));
  }
  const accepted = yield* Deferred.make<net.Socket, Error>();
  listener.once('connection', (socket) => {
    Deferred.doneUnsafe(accepted, Effect.succeed(socket));
  });
  listener.once('error', (err) => {
    Deferred.doneUnsafe(accepted, Effect.fail(err));
  });
  const client = net.connect(address.port, '127.0.0.1');
  client.setNoDelay(true);
  const server = yield* Deferred.await(accepted);
  server.setNoDelay(true);
  listener.close();
  return { client, server };
});

export const createLoopbackPair = (): Promise<{ client: net.Socket; server: net.Socket }> =>
  Effect.runPromise(createLoopbackPairEffect);

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
    Effect.runFork(
      Effect.tryPromise({
        try: () => this.dial(port),
        catch: (err) => (err instanceof Error ? err : new TunnelClosedError('dial failed')),
      }).pipe(
        Effect.match({
          onSuccess: (socket) => {
            callback(null, socket);
          },
          onFailure: (err) => {
            fail(err);
          },
        }),
      ),
    );
    return null;
  }
}
