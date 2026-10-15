import net from 'node:net';
import { Cause, Effect } from 'effect';
import { TunnelClosedError } from './errors.ts';
import type { StreamMux } from './stream-mux.ts';
import type { StreamSink } from './types.ts';

/**
 * Bridge a real TCP socket to one tunnel stream, both directions, with
 * backpressure. Used for desk sockets, gateway sockets and the loopback
 * sockets behind the HTTP agent, so every path shares the same behavior.
 * `onStreamFailed` runs after the socket is destroyed with the stream error,
 * so owners holding the other end of a loopback pair can fail it the same way.
 */
export function attachSocketToStream(
  mux: StreamMux,
  streamId: number,
  socket: net.Socket,
  hooks?: { onStreamFailed?: (err: Error) => void },
): void {
  socket.setNoDelay(true);
  const sink: StreamSink = {
    onData(chunk: Buffer): boolean {
      if (socket.destroyed) {
        return true;
      }
      const accepted = socket.write(chunk);
      if (!accepted) {
        mux.noteSinkFull(streamId);
      }
      return accepted;
    },
    onEnded(): void {
      mux.unregisterStream(streamId);
      if (!socket.destroyed) {
        socket.end();
      }
    },
    onFailed(err: Error): void {
      mux.unregisterStream(streamId);
      if (!socket.destroyed) {
        socket.destroy(err);
      }
      try {
        hooks?.onStreamFailed?.(err);
      } catch {
        // Teardown best-effort.
      }
    },
    onSendResumed(): void {
      if (!socket.destroyed) {
        socket.resume();
      }
    },
  };
  mux.registerStream(streamId, sink);

  // Destroying a socket with an error emits 'error'; the 'close' handler
  // below does the real teardown, so this only prevents uncaught exceptions.
  socket.on('error', () => undefined);
  socket.on('drain', () => {
    mux.noteDrained(streamId);
  });
  socket.on('data', (chunk: Buffer) => {
    socket.pause();
    Effect.runFork(
      mux.sendStreamDataEffect(streamId, chunk).pipe(
        Effect.matchCause({
          onSuccess: () => {
            if (!socket.destroyed) {
              socket.resume();
            }
          },
          onFailure: (cause) => {
            const err = Cause.squash(cause);
            socket.destroy(err instanceof Error ? err : new TunnelClosedError('send failed'));
          },
        }),
      ),
    );
  });
  socket.on('end', () => {
    mux.enqueueTeardown(streamId, 'fin');
  });
  socket.on('close', (hadError: boolean) => {
    mux.enqueueTeardown(streamId, hadError ? { closed: 'socket error' } : 'fin');
  });
}
