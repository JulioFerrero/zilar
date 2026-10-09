import net from 'node:net';
import { Cause, Deferred, Duration, Effect } from 'effect';
import type { WebSocket } from 'ws';
import {
  FRAME_DATA,
  FRAME_FIN,
  MAX_FRAME_BYTES,
  decodeBinaryFrame,
  encodeBinaryFrame,
  type ControlMessage,
} from './protocol.ts';

/** The tunnel died (or never existed) while a stream was using it. Never hangs: always thrown. */
export class TunnelClosedError extends Error {
  constructor(reason: string) {
    super(`tunnel closed: ${reason}`);
    this.name = 'TunnelClosedError';
  }
}

/**
 * One live stream's remote endpoint. Implemented by the socket bridge; the mux
 * only routes bytes and lifecycle, it never interprets them.
 */
export interface StreamSink {
  /** Remote bytes arrived. Return false when full: the mux then asks the sender to pause. */
  onData(chunk: Buffer): boolean;
  /** The remote end finished writing. */
  onEnded(): void;
  /** The stream died: refused, reset, or the whole tunnel went away. */
  onFailed(err: Error): void;
  /** The remote end asked us to resume sending after a pause. */
  onSendResumed(): void;
}

export interface StreamMuxOptions {
  /** Bytes the WebSocket may buffer before senders pause their source. Default 1 MiB. */
  highWaterMarkBytes?: number;
}

/**
 * Multiplexes streams over one WebSocket. Both sides share this class; only
 * the stream-id parity differs (the server allocates even ids, the runner odd).
 *
 * Backpressure, end to end: a slow sink makes `onData` return false, which
 * sends `tunnel.pause`; the sender pauses its source socket. Separately, a
 * sender whose WebSocket buffer is full stops reading its own source. Either
 * way memory stays bounded and nothing is silently dropped.
 */
export class StreamMux {
  /** Binary frames for streams nobody knows, dropped and counted (never fatal). */
  unknownStreamsDropped = 0;
  /** Highest `bufferedAmount` seen on this socket. Reported by the 50 MB test. */
  peakBufferedAmount = 0;

  private readonly highWaterMark: number;
  private nextId: number;
  private readonly streams = new Map<number, StreamSink>();
  private readonly locallyPaused = new Set<number>();
  private readonly pausedByRemote = new Set<number>();
  private readonly resumeWaiters = new Map<number, Array<Deferred.Deferred<void, Error>>>();
  private readonly tails = new Map<number, Deferred.Deferred<void>>();
  private failed: Error | null = null;

  private readonly ws: WebSocket;

  constructor(ws: WebSocket, startId: number, options?: StreamMuxOptions) {
    this.ws = ws;
    this.nextId = startId;
    this.highWaterMark = options?.highWaterMarkBytes ?? 1024 * 1024;
  }

  allocateId(): number {
    const id = this.nextId;
    this.nextId += 2;
    return id;
  }

  registerStream(streamId: number, sink: StreamSink): void {
    this.streams.set(streamId, sink);
  }

  hasStream(streamId: number): boolean {
    return this.streams.has(streamId);
  }

  /** Returns false when the stream was already gone (teardown is idempotent). */
  unregisterStream(streamId: number): boolean {
    this.locallyPaused.delete(streamId);
    this.pausedByRemote.delete(streamId);
    return this.streams.delete(streamId);
  }

  sendControl(message: ControlMessage): void {
    this.throwIfDead();
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      throw new TunnelClosedError('websocket send failed');
    }
  }

  /**
   * Send bytes on a stream, chunked to the max frame size. Waits while the
   * remote asked for pause and while the socket buffer is over the high-water
   * mark, so the caller can stop reading its source. Sends on one stream are
   * served FIFO: concurrent calls are queued behind each other, and a queued
   * teardown always runs last, so a FIN can never overtake trailing data.
   */
  sendStreamData(streamId: number, chunk: Buffer): Promise<void> {
    return Effect.runPromise(this.sendStreamDataEffect(streamId, chunk));
  }

  /**
   * `sendStreamData` as an Effect, for callers that already run on a fiber.
   * The stream's queue slot is taken when the Effect starts running, so a
   * teardown queued after it can never overtake it.
   */
  sendStreamDataEffect(streamId: number, chunk: Buffer): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      const previous = this.tails.get(streamId);
      const current = Deferred.makeUnsafe<void>();
      this.tails.set(streamId, current);
      const release = Effect.sync(() => {
        if (this.tails.get(streamId) === current) {
          this.tails.delete(streamId);
        }
        Deferred.doneUnsafe(current, Effect.void);
      });
      return (previous === undefined ? Effect.void : Deferred.await(previous)).pipe(
        Effect.andThen(this.sendNow(streamId, chunk)),
        Effect.ensuring(release),
      );
    });
  }

  /**
   * Tear a stream down after everything queued for it has gone out: a clean
   * FIN, or a `tunnel.closed` with a reason. Only the first teardown per
   * stream acts; the rest are no-ops. Never throws.
   */
  enqueueTeardown(streamId: number, kind: 'fin' | { closed: string }): void {
    const previous = this.tails.get(streamId);
    const done = Deferred.makeUnsafe<void>();
    this.tails.set(streamId, done);
    const teardown = Effect.gen({ self: this }, function* () {
      if (previous !== undefined) {
        yield* Deferred.await(previous);
      }
      if (this.unregisterStream(streamId)) {
        if (kind === 'fin') {
          this.sendFin(streamId);
        } else {
          // The tunnel is dying; failAll below cleans the stream up.
          yield* Effect.try(() =>
            this.sendControl({ type: 'tunnel.closed', stream_id: streamId, reason: kind.closed }),
          ).pipe(Effect.ignore);
        }
      }
    });
    Effect.runFork(
      teardown.pipe(
        Effect.catchCause(() => Effect.void),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.tails.get(streamId) === done) {
              this.tails.delete(streamId);
            }
            Deferred.doneUnsafe(done, Effect.void);
          }),
        ),
      ),
    );
  }

  private sendNow(streamId: number, chunk: Buffer): Effect.Effect<void, Error> {
    return Effect.gen({ self: this }, function* () {
      let offset = 0;
      while (offset < chunk.length) {
        yield* this.waitSendable(streamId);
        const end = Math.min(chunk.length, offset + MAX_FRAME_BYTES);
        const frame = encodeBinaryFrame(streamId, FRAME_DATA, chunk.subarray(offset, end));
        offset = end;
        this.peakBufferedAmount = Math.max(this.peakBufferedAmount, this.ws.bufferedAmount);
        yield* this.sendRaw(frame);
      }
    });
  }

  sendFin(streamId: number): void {
    if (this.ws.readyState !== this.ws.OPEN) {
      return;
    }
    try {
      this.ws.send(encodeBinaryFrame(streamId, FRAME_FIN, Buffer.alloc(0)));
    } catch {
      // Teardown best-effort: the peer detects the dead socket anyway.
    }
  }

  /** Route one incoming binary frame. Never throws. */
  handleBinary(data: Buffer): void {
    let frame: ReturnType<typeof decodeBinaryFrame>;
    try {
      frame = decodeBinaryFrame(data);
    } catch {
      this.unknownStreamsDropped += 1;
      return;
    }
    if (frame === null || (frame.kind !== FRAME_DATA && frame.kind !== FRAME_FIN)) {
      this.unknownStreamsDropped += 1;
      return;
    }
    const sink = this.streams.get(frame.streamId);
    if (sink === undefined) {
      this.unknownStreamsDropped += 1;
      return;
    }
    try {
      if (frame.kind === FRAME_FIN) {
        this.unregisterStream(frame.streamId);
        sink.onEnded();
      } else {
        const accepted = sink.onData(frame.payload);
        if (!accepted) {
          this.noteSinkFull(frame.streamId);
        }
      }
    } catch {
      this.unregisterStream(frame.streamId);
      try {
        sink.onFailed(new TunnelClosedError('stream sink threw'));
      } catch {
        // Last resort: never let a bad sink kill the mux.
      }
    }
  }

  handlePause(streamId: number): void {
    if (!this.streams.has(streamId)) {
      return;
    }
    this.pausedByRemote.add(streamId);
  }

  handleResume(streamId: number): void {
    if (!this.pausedByRemote.delete(streamId)) {
      return;
    }
    const waiters = this.resumeWaiters.get(streamId);
    this.resumeWaiters.delete(streamId);
    for (const waiter of waiters ?? []) {
      Deferred.doneUnsafe(waiter, Effect.void);
    }
  }

  noteSinkFull(streamId: number): void {
    if (this.locallyPaused.has(streamId) || !this.streams.has(streamId)) {
      return;
    }
    this.locallyPaused.add(streamId);
    try {
      this.sendControl({ type: 'tunnel.pause', stream_id: streamId });
    } catch {
      // The tunnel is dying; failAll below will clean the stream up.
    }
  }

  noteDrained(streamId: number): void {
    if (!this.locallyPaused.delete(streamId)) {
      return;
    }
    try {
      this.sendControl({ type: 'tunnel.resume', stream_id: streamId });
    } catch {
      // Same as above.
    }
  }

  /** Fail one stream now: unregisters it and tells its sink. Returns false when unknown. */
  failStream(streamId: number, err: Error): boolean {
    const sink = this.streams.get(streamId);
    if (sink === undefined) {
      return false;
    }
    this.unregisterStream(streamId);
    try {
      sink.onFailed(err);
    } catch {
      // See handleBinary: a bad sink never kills the mux.
    }
    return true;
  }

  /** The socket died: every live stream fails now with a clear error, none hang. */
  failAll(err: Error): void {
    if (this.failed !== null) {
      return;
    }
    this.failed = err;
    for (const waiters of this.resumeWaiters.values()) {
      for (const waiter of waiters) {
        Deferred.doneUnsafe(waiter, Effect.fail(err));
      }
    }
    this.resumeWaiters.clear();
    const sinks = [...this.streams.entries()];
    this.streams.clear();
    this.locallyPaused.clear();
    this.pausedByRemote.clear();
    for (const [, sink] of sinks) {
      try {
        sink.onFailed(err);
      } catch {
        // See handleBinary: a bad sink never kills the mux.
      }
    }
  }

  private deadError(): Error | null {
    if (this.failed !== null) {
      return this.failed;
    }
    if (this.ws.readyState !== this.ws.OPEN) {
      return new TunnelClosedError('websocket is not open');
    }
    return null;
  }

  private throwIfDead(): void {
    const dead = this.deadError();
    if (dead !== null) {
      throw dead;
    }
  }

  private failIfDead(): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      const dead = this.deadError();
      return dead === null ? Effect.void : Effect.fail(dead);
    });
  }

  private waitSendable(streamId: number): Effect.Effect<void, Error> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        yield* this.failIfDead();
        if (!this.pausedByRemote.has(streamId) && this.ws.bufferedAmount <= this.highWaterMark) {
          return;
        }
        if (this.pausedByRemote.has(streamId)) {
          yield* this.waitResume(streamId);
        } else {
          yield* Effect.sleep(Duration.millis(2));
        }
      }
    });
  }

  private waitResume(streamId: number): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      const waiter = Deferred.makeUnsafe<void, Error>();
      const list = this.resumeWaiters.get(streamId) ?? [];
      list.push(waiter);
      this.resumeWaiters.set(streamId, list);
      return Deferred.await(waiter);
    });
  }

  private sendRaw(frame: Buffer): Effect.Effect<void, Error> {
    return this.failIfDead().pipe(
      Effect.andThen(
        Effect.callback<void, Error>((resume) => {
          try {
            this.ws.send(frame, (err) => {
              resume(err ? Effect.fail(new TunnelClosedError(err.message)) : Effect.void);
            });
          } catch (err) {
            resume(
              Effect.fail(
                err instanceof Error ? err : new TunnelClosedError('websocket send failed'),
              ),
            );
          }
        }),
      ),
    );
  }
}

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
